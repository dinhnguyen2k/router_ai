/**
 * The stable local endpoint a CLI is pointed at.
 *
 * Two surfaces are exposed over the same pool: an OpenAI-compatible one and a
 * Gemini-compatible one. Which one a client uses decides which credentials are
 * eligible, because the router forwards bodies unmodified and will not move a
 * request between protocols.
 */

import express, { type Request, type Response, type Router } from 'express';
import crypto from 'node:crypto';
import { RouterCore, type ResponseSink, type RouteRequest } from '../core/router.js';
import { AccountPool } from '../core/pool.js';
import { pickForwardableHeaders } from '../providers/registry.js';
import { log } from '../core/logger.js';
import type { UpstreamProtocol } from '../../shared/types.js';

/** Requests larger than this are refused before any credential is touched. */
const MAX_BODY = '32mb';

/**
 * Adapts an Express response to the router's sink.
 *
 * `writable` is what the router polls to notice a client disconnect mid-stream;
 * it goes false as soon as the socket is destroyed.
 */
class ExpressSink implements ResponseSink {
  private headWritten = false;

  constructor(private readonly res: Response) {}

  writeHead(status: number, headers: Record<string, string>): void {
    if (this.headWritten || this.res.headersSent) return;
    this.headWritten = true;
    this.res.writeHead(status, headers);
  }

  write(chunk: Uint8Array): void {
    if (!this.writable) return;
    this.res.write(chunk);
    // Streaming responses must reach the client as they arrive; without an
    // explicit flush Node can hold small SSE events in the socket buffer and
    // the CLI appears to hang until enough output accumulates.
    const flushable = this.res as Response & { flush?: () => void };
    if (typeof flushable.flush === 'function') flushable.flush();
  }

  end(): void {
    if (this.res.writableEnded) return;
    this.res.end();
  }

  get writable(): boolean {
    return !this.res.writableEnded && !this.res.destroyed;
  }
}

function jsonError(res: Response, status: number, code: string, message: string): void {
  if (res.headersSent) return;
  res.status(status).json({ error: { code, message } });
}

/**
 * Extracts the caller's local token.
 *
 * All three spellings are accepted because a client configured for OpenAI, one
 * configured for Gemini, and one that only supports a query parameter all have
 * to reach the same router.
 */
function inboundToken(req: Request): string | null {
  const authorization = req.header('authorization');
  if (authorization !== undefined) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match !== null) return match[1].trim();
  }
  const googleKey = req.header('x-goog-api-key');
  if (googleKey !== undefined && googleKey.trim() !== '') return googleKey.trim();
  const apiKey = req.header('x-api-key');
  if (apiKey !== undefined && apiKey.trim() !== '') return apiKey.trim();
  const queryKey = req.query.key;
  if (typeof queryKey === 'string' && queryKey.trim() !== '') return queryKey.trim();
  return null;
}

/**
 * Compares tokens without leaking length or position through timing.
 *
 * The router holds real provider credentials, so its own gate is worth closing
 * properly even on loopback.
 */
function tokenMatches(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseBodyMetadata(body: Buffer): Record<string, unknown> {
  try {
    const parsed = JSON.parse(body.toString('utf8')) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Bridges an Express request's lifetime to an AbortSignal. */
function clientAbortSignal(req: Request, res: Response): AbortSignal {
  const controller = new AbortController();
  const abort = (): void => {
    if (!controller.signal.aborted) controller.abort(new Error('client closed request'));
  };
  req.on('aborted', abort);
  res.on('close', () => {
    if (!res.writableEnded) abort();
  });
  return controller.signal;
}

export interface GatewayDeps {
  core: RouterCore;
  pool: AccountPool;
  localToken: string;
}

/**
 * Whether a path belongs to the CLI-facing gateway.
 *
 * The gateway is mounted at the root because Gemini clients build their own
 * version prefix, so it has to decline everything else explicitly — otherwise
 * its auth check and catch-all would swallow the dashboard's static files and
 * answer 401 to a browser.
 */
function isGatewayPath(path: string): boolean {
  if (path === '/v1' || path.startsWith('/v1/')) return true;
  if (/^\/v1beta\d*(\/|$)/.test(path)) return true;
  return GENERATE_TAIL.test(path);
}

const GENERATE_TAIL = /\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/;

export function createGateway(deps: GatewayDeps): Router {
  const router = express.Router();

  // Anything the gateway does not own falls through untouched, so the static
  // dashboard mounted after it still serves.
  router.use((req, _res, next) => {
    if (!isGatewayPath(req.path)) {
      next('router');
      return;
    }
    next();
  });

  // The body is kept as raw bytes so it can be forwarded verbatim. Parsing it
  // into an object and re-serialising would reorder keys and could alter
  // number formatting, which is exactly what must not happen to a payload
  // carrying tool-call ids.
  router.use(express.raw({ type: () => true, limit: MAX_BODY }));

  router.use((req, res, next) => {
    const token = inboundToken(req);
    if (token === null || !tokenMatches(token, deps.localToken)) {
      jsonError(
        res,
        401,
        'unauthorized',
        'a valid local router token is required; see the token printed at startup',
      );
      return;
    }
    next();
  });

  // --- Model listing -------------------------------------------------------

  router.get('/v1/models', (_req, res) => {
    res.json({ object: 'list', data: listModels(deps.pool, 'openai') });
  });

  // Matched loosely for the same reason as the generate routes: the version
  // prefix depends on how the client's base URL was configured.
  router.get(/\/models$/, (_req, res) => {
    res.json({
      models: listModels(deps.pool, 'gemini').map((model) => ({
        name: `models/${model.id}`,
        displayName: model.id,
        supportedGenerationMethods: ['generateContent', 'streamGenerateContent'],
      })),
    });
  });

  // --- OpenAI-compatible ---------------------------------------------------

  router.post('/v1/chat/completions', (req, res) => {
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0) {
      jsonError(res, 400, 'empty_body', 'request body is required');
      return;
    }
    const metadata = parseBodyMetadata(body);
    const model = typeof metadata.model === 'string' ? metadata.model.trim() : '';
    if (model === '') {
      jsonError(res, 400, 'missing_model', 'request body must include a "model" field');
      return;
    }

    void handle(deps, req, res, {
      protocol: 'openai',
      model,
      stream: metadata.stream === true,
      body,
    });
  });

  // --- Gemini-compatible ---------------------------------------------------

  // Express 4's path parser treats ":" as a parameter marker, so the Gemini
  // "models/<model>:<action>" shape is matched with an explicit regex instead
  // of a path pattern.
  //
  // Only the tail is anchored, because what precedes it depends on how the
  // client was configured: a Google SDK given GOOGLE_GEMINI_BASE_URL appends
  // its own /v1beta, so an operator who sets the base URL to ".../v1beta"
  // produces a doubled prefix. Matching the tail accepts every spelling rather
  // than answering 404 to a setup that is only cosmetically wrong.
  const GEMINI_PATH = /\/models\/([^/]+?):(generateContent|streamGenerateContent)$/;

  router.post(/\/models\/[^/]+:(?:generateContent|streamGenerateContent)$/, (req, res) => {
    const match = GEMINI_PATH.exec(req.path);
    if (match === null) {
      jsonError(res, 404, 'not_found', `unsupported path: ${req.path}`);
      return;
    }
    const [, rawModel, action] = match;
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (body.length === 0) {
      jsonError(res, 400, 'empty_body', 'request body is required');
      return;
    }

    void handle(deps, req, res, {
      protocol: 'gemini',
      model: decodeURIComponent(rawModel),
      stream: action === 'streamGenerateContent',
      body,
    });
  });

  router.use((req, res) => {
    jsonError(res, 404, 'not_found', `unsupported path: ${req.method} ${req.path}`);
  });

  return router;
}

async function handle(
  deps: GatewayDeps,
  req: Request,
  res: Response,
  route: { protocol: UpstreamProtocol; model: string; stream: boolean; body: Buffer },
): Promise<void> {
  const sink = new ExpressSink(res);
  const signal = clientAbortSignal(req, res);

  // The router mirrors the inbound query upstream (Gemini's `alt`), but the
  // local token must never be forwarded to a provider.
  const query = new URLSearchParams(
    req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '',
  );
  query.delete('key');

  const request: RouteRequest = {
    protocol: route.protocol,
    model: route.model,
    stream: route.stream,
    body: route.body,
    passthroughHeaders: pickForwardableHeaders(req.headers),
    query: query.toString(),
    signal,
  };

  try {
    await deps.core.route(request, sink);
  } catch (err) {
    log.error('unhandled routing failure', {
      model: route.model,
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      jsonError(res, 500, 'internal_error', 'the router failed to handle this request');
    } else {
      sink.end();
    }
  }
}

/**
 * The union of models the pool can serve on a protocol.
 *
 * Credentials with no declared models contribute nothing here — there is no
 * catalogue to report for them — but they still serve any model at request
 * time, so the listing is a hint rather than a whitelist.
 */
function listModels(
  pool: AccountPool,
  protocol: UpstreamProtocol,
): Array<{ id: string; object: string; owned_by: string }> {
  const seen = new Map<string, string>();
  for (const account of pool.all()) {
    if (account.protocol !== protocol || !account.enabled) continue;
    for (const model of account.models) {
      if (!seen.has(model)) seen.set(model, account.provider);
    }
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([id, owner]) => ({ id, object: 'model', owned_by: owner }));
}
