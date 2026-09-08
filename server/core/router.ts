/**
 * Router Core: selection, retry, failover, and the stream commit boundary.
 *
 * The request body is forwarded to the upstream byte-for-byte. Nothing here
 * rewrites conversation payloads, tool-call ids, or response ids, and failover
 * only ever moves a request between credentials that speak the same protocol
 * and serve the same model — so a retried request is the identical request,
 * just presented with a different key.
 */

import crypto from 'node:crypto';
import { AccountPool, type PoolAccount } from './pool.js';
import { Selector, eligibleCandidates, type NoCandidateReason } from './selector.js';
import { Semaphore, sleep } from './concurrency.js';
import { retryRoundDelay } from './backoff.js';
import {
  RouterError,
  classifyHttpFailure,
  classifyTransportError,
  summarizeUpstreamError,
} from './errors.js';
import {
  SSE_DONE,
  StreamState,
  readStreamBootstrap,
  sseErrorEvent,
} from './stream.js';
import { StreamUsageCollector, extractUsage, EMPTY_USAGE, type UsageCounts } from './usage.js';
import { buildUpstreamTarget } from '../providers/registry.js';
import { log } from './logger.js';
import type { LogStore } from '../db/logs.js';
import type { SettingsStore } from '../db/settings.js';
import type {
  RequestAttemptDto,
  RequestLogDto,
  RequestOutcome,
  UpstreamProtocol,
} from '../../shared/types.js';

/**
 * Where a routed response is written.
 *
 * The router owns the moment the head is sent, because that moment is exactly
 * when failover becomes illegal. Implemented by the gateway over an HTTP
 * response, and by tests over an in-memory buffer.
 */
export interface ResponseSink {
  writeHead(status: number, headers: Record<string, string>): void;
  write(chunk: Uint8Array): void;
  end(): void;
  readonly writable: boolean;
}

export interface RouteRequest {
  protocol: UpstreamProtocol;
  model: string;
  stream: boolean;
  /** Forwarded verbatim. */
  body: Buffer;
  /** Allowlisted inbound headers to carry upstream. */
  passthroughHeaders: Record<string, string>;
  /** Inbound query string, mirrored upstream. Used by Gemini's `alt`. */
  query: string;
  /** Aborts when the downstream client disconnects. */
  signal: AbortSignal;
}

export interface RouteResult {
  outcome: RequestOutcome;
  status: number | null;
  logId: string;
}

/** Signals that no credential could serve the request at all. */
export class NoCandidateError extends RouterError {
  readonly detail: NoCandidateReason;

  constructor(detail: NoCandidateReason, message: string, status: number) {
    super({
      message,
      errorClass: detail.kind === 'no_model_match' ? 'request_fault' : 'rate_limit',
      scope: detail.kind === 'no_model_match' ? 'request' : 'credential',
      status,
    });
    this.name = 'NoCandidateError';
    this.detail = detail;
  }
}

interface AttemptOutcome {
  status: number;
  usage: UsageCounts;
}

export class RouterCore {
  private readonly selector: Selector;
  private readonly gate: Semaphore;
  private readonly startedAt = Date.now();

  constructor(
    private readonly pool: AccountPool,
    private readonly settings: SettingsStore,
    private readonly logs: LogStore,
  ) {
    const current = settings.get();
    this.selector = new Selector(current.strategy);
    this.gate = new Semaphore(current.maxGlobalConcurrency);
  }

  get uptimeMs(): number {
    return Date.now() - this.startedAt;
  }

  get strategy(): Selector {
    return this.selector;
  }

  /** Re-reads settings that are cached in live objects. */
  applySettings(): void {
    const current = this.settings.get();
    this.selector.setStrategy(current.strategy);
    this.gate.resize(current.maxGlobalConcurrency);
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  async route(request: RouteRequest, sink: ResponseSink): Promise<RouteResult> {
    const settings = this.settings.get();
    const startedAt = Date.now();
    const logId = crypto.randomUUID();
    const attempts: RequestAttemptDto[] = [];
    const state = new StreamState(startedAt);
    const attempted = new Set<string>();
    const ringKey = `${request.protocol}:${request.model}`;

    let lastError: RouterError | null = null;
    let servedBy: PoolAccount | null = null;
    let usage: UsageCounts = EMPTY_USAGE;
    let status: number | null = null;
    let outcome: RequestOutcome = 'failed';

    try {
      await this.gate.acquire(request.signal);
    } catch {
      // The client hung up while queued behind the concurrency gate.
      const result = this.finish({
        logId, request, startedAt, state, attempts,
        outcome: 'cancelled', status: 499, account: null, usage,
        error: new RouterError({
          message: 'client closed the request while queued',
          errorClass: 'cancelled', scope: 'client', status: 499,
        }),
      });
      return result;
    }

    try {
      const totalRounds = settings.requestRetryRounds + 1;

      for (let round = 0; round < totalRounds; round += 1) {
        // Each round starts over the pool: a credential excluded in round 0
        // may have come off cooldown by the time round 1 begins.
        if (round > 0) attempted.clear();

        for (;;) {
          if (request.signal.aborted) {
            outcome = 'cancelled';
            status = 499;
            lastError = new RouterError({
              message: 'client closed the request',
              errorClass: 'cancelled',
              scope: 'client',
              status: 499,
            });
            break;
          }
          if (attempted.size >= settings.maxRetryCredentials) break;

          const { candidates, reason } = eligibleCandidates(this.pool, {
            protocol: request.protocol,
            model: request.model,
            exclude: attempted,
            now: Date.now(),
          });

          if (candidates.length === 0) {
            lastError = this.noCandidateError(reason, request.model);
            break;
          }

          const account = this.selector.select(candidates, ringKey);
          attempted.add(account.id);

          const attemptStartedAt = Date.now();
          this.pool.acquire(account);
          try {
            const result = await this.attempt(request, sink, state, account, settings.upstreamTimeoutMs);
            servedBy = account;
            status = result.status;
            usage = result.usage;
            outcome = 'success';
            attempts.push({
              accountId: account.id,
              accountName: account.name,
              status: result.status,
              errorClass: null,
              errorMessage: null,
              durationMs: Date.now() - attemptStartedAt,
              committed: state.committed,
            });
            this.pool.recordSuccess(account, {
              promptTokens: result.usage.promptTokens ?? 0,
              completionTokens: result.usage.completionTokens ?? 0,
            });
            lastError = null;
            break;
          } catch (err) {
            const routerError =
              err instanceof RouterError
                ? err
                : classifyTransportError(err, { clientAborted: request.signal.aborted });
            lastError = routerError;
            attempts.push({
              accountId: account.id,
              accountName: account.name,
              status: routerError.status,
              errorClass: routerError.errorClass,
              errorMessage: summarizeUpstreamError(routerError.upstreamBody) ?? routerError.message,
              durationMs: Date.now() - attemptStartedAt,
              committed: state.committed,
            });

            // The commit boundary. Past it the client already holds part of
            // this upstream's output, so the request stays pinned here no
            // matter what went wrong.
            if (state.committed) {
              servedBy = account;
              status = 200;
              outcome = routerError.scope === 'client' ? 'cancelled' : 'partial_failure';
              if (routerError.scope === 'credential') {
                this.pool.recordFailure({
                  account,
                  model: request.model,
                  error: routerError,
                  policy: this.backoffPolicy(),
                  disableAfterAuthFailures: settings.disableAfterAuthFailures,
                });
              }
              this.terminateCommittedStream(sink, routerError);
              break;
            }

            if (routerError.scope === 'client') {
              outcome = 'cancelled';
              status = 499;
              break;
            }

            if (routerError.scope === 'request') {
              // Every credential would reject this identically, so it goes
              // straight back to the caller and no account is penalized.
              this.pool.recordFailure({
                account,
                model: request.model,
                error: routerError,
                policy: this.backoffPolicy(),
                disableAfterAuthFailures: settings.disableAfterAuthFailures,
              });
              outcome = 'failed';
              status = routerError.status;
              break;
            }

            this.pool.recordFailure({
              account,
              model: request.model,
              error: routerError,
              policy: this.backoffPolicy(),
              disableAfterAuthFailures: settings.disableAfterAuthFailures,
            });
            log.warn('upstream attempt failed, trying next credential', {
              account: account.name,
              model: request.model,
              errorClass: routerError.errorClass,
              status: routerError.status,
            });
          } finally {
            this.pool.release(account);
          }
        }

        if (outcome === 'success' || outcome === 'cancelled' || outcome === 'partial_failure') break;
        if (lastError !== null && lastError.scope === 'request') break;
        if (state.committed) break;

        // Another round is only worth waiting for when something is expected
        // to come back. Waiting out a 30-minute quota window would hang the
        // CLI, so the wait is capped and skipped when it would exceed the cap.
        if (round + 1 >= totalRounds) break;
        const wait = this.roundWait(lastError, round, settings.maxRetryIntervalMs);
        if (wait === null) break;
        try {
          await sleep(wait, request.signal);
        } catch {
          outcome = 'cancelled';
          status = 499;
          break;
        }
      }

      if (outcome === 'failed' && lastError !== null && !state.committed) {
        status = lastError.status ?? 503;
        this.writeErrorResponse(sink, lastError);
      }

      return this.finish({
        logId, request, startedAt, state, attempts, outcome, status,
        account: servedBy, usage, error: lastError,
      });
    } finally {
      this.gate.release();
    }
  }

  // -------------------------------------------------------------------------
  // One upstream attempt
  // -------------------------------------------------------------------------

  private async attempt(
    request: RouteRequest,
    sink: ResponseSink,
    state: StreamState,
    account: PoolAccount,
    timeoutMs: number,
  ): Promise<AttemptOutcome> {
    const target = buildUpstreamTarget({
      protocol: account.protocol,
      baseUrl: account.baseUrl,
      apiKey: account.apiKey,
      model: request.model,
      stream: request.stream,
      passthroughHeaders: request.passthroughHeaders,
      query: request.query,
    });

    // The timeout covers connect and first byte only. Once the stream is
    // flowing, a long generation is normal and must not be cut off.
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new Error('upstream timeout')), timeoutMs);
    const signal = AbortSignal.any([request.signal, timeoutController.signal]);
    let timedOut = false;
    timeoutController.signal.addEventListener('abort', () => {
      timedOut = true;
    });

    let response: Response;
    try {
      response = await fetch(target.url, {
        method: 'POST',
        headers: target.headers,
        body: request.body,
        signal,
        // Node streams the response body only when duplex is unset for a
        // Buffer body; keeping redirect manual avoids silently following a
        // redirect that would drop the auth header.
        redirect: 'manual',
      });
    } catch (err) {
      clearTimeout(timer);
      throw classifyTransportError(err, {
        timedOut,
        clientAborted: request.signal.aborted,
      });
    }

    if (!response.ok) {
      clearTimeout(timer);
      const bodyText = await response.text().catch(() => '');
      throw classifyHttpFailure(response.status, response.headers, bodyText);
    }

    state.markUpstreamAccepted();

    if (!request.stream) {
      clearTimeout(timer);
      const bodyText = await response.text();
      state.markCommitted(Buffer.byteLength(bodyText));
      sink.writeHead(response.status, this.downstreamHeaders(response, false));
      sink.write(Buffer.from(bodyText));
      sink.end();
      state.markCompleted();
      return { status: response.status, usage: extractUsage(bodyText) };
    }

    if (response.body === null) {
      clearTimeout(timer);
      throw new RouterError({
        message: 'upstream returned an empty stream',
        errorClass: 'server',
        scope: 'credential',
        status: 502,
      });
    }

    const reader = response.body.getReader();
    const usage = new StreamUsageCollector();

    // Bootstrap: read until the first real payload. Nothing is written to the
    // client here, so any failure below is still safe to fail over.
    let bootstrap;
    try {
      bootstrap = await readStreamBootstrap(reader, signal);
    } catch (err) {
      clearTimeout(timer);
      await reader.cancel().catch(() => undefined);
      throw classifyTransportError(err, {
        timedOut,
        clientAborted: request.signal.aborted,
      });
    }
    clearTimeout(timer);

    if (bootstrap.exhausted && bootstrap.buffered.length === 0) {
      // A 200 with no body at all. Another credential may do better, and
      // nothing has been sent downstream, so this is retryable.
      throw new RouterError({
        message: 'upstream closed the stream before sending any data',
        errorClass: 'server',
        scope: 'credential',
        status: 502,
      });
    }

    // --- COMMIT -------------------------------------------------------------
    sink.writeHead(200, this.downstreamHeaders(response, true));
    for (const chunk of bootstrap.buffered) {
      sink.write(chunk);
      usage.push(chunk);
      state.markCommitted(chunk.byteLength);
    }

    if (bootstrap.exhausted) {
      sink.end();
      state.markCompleted();
      return { status: 200, usage: usage.result() };
    }

    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        await reader.cancel().catch(() => undefined);
        throw classifyTransportError(err, {
          clientAborted: request.signal.aborted,
        });
      }

      if (chunk.done) break;
      if (chunk.value === undefined || chunk.value.byteLength === 0) continue;

      if (!sink.writable) {
        // The client went away mid-stream. Stop pulling from the upstream
        // rather than draining a generation nobody will read.
        await reader.cancel().catch(() => undefined);
        state.markCancelled();
        throw new RouterError({
          message: 'client closed the stream',
          errorClass: 'cancelled',
          scope: 'client',
          status: 499,
        });
      }

      sink.write(chunk.value);
      usage.push(chunk.value);
      state.markCommitted(chunk.value.byteLength);
    }

    sink.end();
    state.markCompleted();
    return { status: 200, usage: usage.result() };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private backoffPolicy() {
    const settings = this.settings.get();
    return {
      baseMs: settings.cooldownBaseMs,
      maxMs: settings.cooldownMaxMs,
      transientMs: settings.transientCooldownMs,
    };
  }

  /**
   * Headers passed back to the client.
   *
   * Only content framing is copied. Upstream rate-limit headers are
   * deliberately dropped: they describe one credential in a rotating pool, so
   * forwarding them would tell the CLI to back off over a limit that the next
   * request will not even be subject to.
   */
  private downstreamHeaders(response: Response, stream: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (stream) {
      headers['content-type'] = response.headers.get('content-type') ?? 'text/event-stream';
      headers['cache-control'] = 'no-cache, no-transform';
      headers.connection = 'keep-alive';
      headers['x-accel-buffering'] = 'no';
    } else {
      headers['content-type'] = response.headers.get('content-type') ?? 'application/json';
    }
    return headers;
  }

  private noCandidateError(reason: NoCandidateReason | null, model: string): RouterError {
    if (reason === null) {
      return new RouterError({
        message: 'no credential available',
        errorClass: 'unknown',
        scope: 'credential',
        status: 503,
      });
    }
    switch (reason.kind) {
      case 'empty_pool':
        return new NoCandidateError(reason, 'no credentials are configured for this protocol', 503);
      case 'no_model_match':
        return new NoCandidateError(
          reason,
          `no configured credential serves model "${model}"`,
          404,
        );
      case 'all_cooldown': {
        const seconds =
          reason.earliestRetryAt === null
            ? null
            : Math.max(0, Math.ceil((reason.earliestRetryAt - Date.now()) / 1000));
        return new NoCandidateError(
          reason,
          seconds === null
            ? 'every credential is in cooldown'
            : `every credential is in cooldown; the first recovers in ${seconds}s`,
          429,
        );
      }
      case 'all_saturated':
        return new NoCandidateError(reason, 'every credential is at its concurrency limit', 503);
      case 'all_excluded':
        return new NoCandidateError(reason, 'every credential has already been tried for this request', 503);
    }
  }

  /**
   * How long to pause before another pass over the pool.
   *
   * Returns null when waiting is pointless (nothing is coming back) or when the
   * recovery time exceeds the cap, in which case the caller is told now rather
   * than left hanging.
   */
  private roundWait(
    error: RouterError | null,
    round: number,
    maxIntervalMs: number,
  ): number | null {
    if (error === null) return null;
    if (error instanceof NoCandidateError) {
      const { detail } = error;
      if (detail.kind === 'no_model_match' || detail.kind === 'empty_pool') return null;
      if (detail.kind === 'all_cooldown') {
        if (detail.earliestRetryAt === null) return null;
        const wait = detail.earliestRetryAt - Date.now();
        if (wait > maxIntervalMs) return null;
        return Math.max(wait, 0);
      }
    }
    return retryRoundDelay(round, maxIntervalMs);
  }

  /**
   * Ends a stream that has already delivered bytes.
   *
   * The HTTP status is long since sent, so the failure is reported as a
   * terminal SSE error event. No [DONE] is emitted: a client that saw an error
   * event must not treat the stream as a normal completion.
   */
  private terminateCommittedStream(sink: ResponseSink, error: RouterError): void {
    if (!sink.writable) return;
    if (error.scope !== 'client') {
      sink.write(
        Buffer.from(
          sseErrorEvent({
            message: summarizeUpstreamError(error.upstreamBody) ?? error.message,
            type: error.errorClass,
            code: error.status === null ? null : String(error.status),
          }),
        ),
      );
    }
    sink.end();
  }

  private writeErrorResponse(sink: ResponseSink, error: RouterError): void {
    if (!sink.writable) return;
    const status = error.status ?? 503;
    const body = JSON.stringify({
      error: {
        message: summarizeUpstreamError(error.upstreamBody) ?? error.message,
        type: error.errorClass,
        code: error instanceof NoCandidateError ? error.detail.kind : null,
      },
    });
    sink.writeHead(status, { 'content-type': 'application/json' });
    sink.write(Buffer.from(body));
    sink.end();
  }

  private finish(input: {
    logId: string;
    request: RouteRequest;
    startedAt: number;
    state: StreamState;
    attempts: RequestAttemptDto[];
    outcome: RequestOutcome;
    status: number | null;
    account: PoolAccount | null;
    usage: UsageCounts;
    error: RouterError | null;
  }): RouteResult {
    const entry: RequestLogDto = {
      id: input.logId,
      createdAt: input.startedAt,
      protocol: input.request.protocol,
      model: input.request.model,
      stream: input.request.stream,
      outcome: input.outcome,
      status: input.status,
      accountId: input.account?.id ?? null,
      accountName: input.account?.name ?? null,
      durationMs: Date.now() - input.startedAt,
      ttfbMs: input.state.ttfbMs,
      attemptCount: input.attempts.length,
      attempts: input.attempts,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      errorClass: input.error?.errorClass ?? null,
      errorMessage:
        input.error === null
          ? null
          : summarizeUpstreamError(input.error.upstreamBody) ?? input.error.message,
    };

    try {
      this.logs.insert(entry);
    } catch (err) {
      // A log write must never take down a request that already succeeded.
      log.error('failed to persist request log', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    log.info('request routed', {
      model: entry.model,
      outcome: entry.outcome,
      status: entry.status,
      account: entry.accountName,
      attempts: entry.attemptCount,
      durationMs: entry.durationMs,
      ttfbMs: entry.ttfbMs,
    });

    return { outcome: input.outcome, status: input.status, logId: input.logId };
  }
}

export { SSE_DONE };
