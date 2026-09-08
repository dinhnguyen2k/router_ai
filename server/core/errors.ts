/**
 * Upstream failure classification.
 *
 * Ported from CLIProxyAPI's internal/clienterror + sdk/cliproxy/auth/errors.go.
 * The distinction that matters most here is request-scoped vs credential-scoped:
 * a malformed request fails identically on every credential, so rotating the
 * pool over it burns healthy accounts and hides the real error from the caller.
 */

import type { ErrorClass, ErrorScope } from '../../shared/types.js';

/** nginx-style status for "client went away before we finished". */
export const STATUS_CLIENT_CLOSED_REQUEST = 499;

/**
 * Error codes that identify a fault in the request payload itself. Taken from
 * the upstream bodies CLIProxyAPI observed in production.
 */
const REQUEST_FAULT_CODES = new Set([
  'cyber_policy',
  'context_length_exceeded',
  'message_too_big',
  'string_above_max_length',
  'invalid_prompt',
  'invalid_value',
  'unsupported_value',
  'invalid_request_error',
  'previous_response_not_found',
]);

const REQUEST_FAULT_TYPES = new Set([
  'invalid_request',
  'invalid_request_error',
  'bad_request_error',
  'invalid_prompt',
]);

/**
 * A failure that carries everything the cooldown controller needs to decide
 * what to do with the credential that produced it.
 */
export class RouterError extends Error {
  readonly errorClass: ErrorClass;
  readonly scope: ErrorScope;
  readonly status: number | null;
  /** Seconds parsed from Retry-After / reset metadata, when the upstream sent one. */
  readonly retryAfterMs: number | null;
  /** Raw upstream body, truncated. Surfaced in logs and the dashboard. */
  readonly upstreamBody: string | null;

  constructor(init: {
    message: string;
    errorClass: ErrorClass;
    scope: ErrorScope;
    status?: number | null;
    retryAfterMs?: number | null;
    upstreamBody?: string | null;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = 'RouterError';
    this.errorClass = init.errorClass;
    this.scope = init.scope;
    this.status = init.status ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.upstreamBody = init.upstreamBody ?? null;
  }

  /** Whether trying a different credential could plausibly succeed. */
  get retryable(): boolean {
    return this.scope === 'credential';
  }
}

/** Best-effort JSON parse that never throws. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Reads a dotted path out of a parsed body without assuming its shape. */
function readPath(root: unknown, path: string): string | null {
  let node: unknown = root;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node.trim().toLowerCase() : null;
}

const CODE_PATHS = ['error.code', 'code', 'response.error.code', 'body.error.code'];
const TYPE_PATHS = ['error.type', 'type', 'response.error.type', 'body.error.type'];

function hasRequestFaultBody(body: unknown): boolean {
  if (body === null) return false;
  for (const path of CODE_PATHS) {
    const code = readPath(body, path);
    if (code && REQUEST_FAULT_CODES.has(code)) return true;
  }
  for (const path of TYPE_PATHS) {
    const type = readPath(body, path);
    if (type && REQUEST_FAULT_TYPES.has(type)) return true;
  }
  return false;
}

function hasAuthenticationErrorBody(body: unknown): boolean {
  if (body === null) return false;
  return TYPE_PATHS.some((path) => readPath(body, path) === 'authentication_error');
}

/**
 * Matches the upstream 404 raised when a request references a stored response
 * item the upstream never persisted. It arrives as plain text, so it cannot be
 * recognised structurally. Rotating credentials cannot fix it; the client has
 * to rebuild the request without the stale reference.
 */
export function isItemNotPersisted(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('item with id') &&
    lower.includes('not found') &&
    lower.includes('items are not persisted when `store` is set to false')
  );
}

/**
 * Reports whether a failure is caused by the request rather than the
 * credential, in which case the credential must not be penalized or rotated.
 */
export function isRequestFault(status: number, bodyText: string): boolean {
  // Payment and rate-limit statuses are authoritative even when the upstream
  // pairs them with a generic invalid_request_error body, so the credential
  // stays eligible for cooldown and rotation.
  if (status === 402 || status === 429) return false;

  const body = parseJson(bodyText);

  // Some providers report an invalid API key as 401 with an
  // authentication_error type alongside the generic code. That is a credential
  // failure, not a request fault.
  if (status === 401 && hasAuthenticationErrorBody(body)) return false;

  if (hasRequestFaultBody(body)) return true;
  if (isItemNotPersisted(bodyText)) return true;

  return status === 400 || status === 409 || status === 413 || status === 422;
}

/**
 * Reports whether an error represents the client hanging up rather than an
 * upstream problem.
 */
export function isClientCancellation(err: unknown): boolean {
  if (err instanceof RouterError) return err.errorClass === 'cancelled';
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    const lower = err.message.toLowerCase();
    if (lower.includes('aborted') || lower.includes('client closed request')) {
      return true;
    }
  }
  return false;
}

/**
 * Parses a Retry-After header. Accepts both the delta-seconds and HTTP-date
 * forms defined by RFC 9110.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) {
    return seconds <= 0 ? 0 : Math.round(seconds * 1000);
  }

  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    const delta = date - now;
    return delta <= 0 ? 0 : delta;
  }
  return null;
}

/**
 * Extracts a reset hint from the rate-limit headers the supported upstreams
 * emit. Gemini and the OpenAI-compatible providers disagree on the format, so
 * each recognised spelling is tried in turn.
 */
export function parseResetMetadata(headers: Headers, now = Date.now()): number | null {
  const retryAfter = parseRetryAfter(headers.get('retry-after'), now);
  if (retryAfter !== null) return retryAfter;

  // OpenAI-compatible: "1s", "6m0s", "150ms".
  for (const name of ['x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
    const parsed = parseDurationString(headers.get(name));
    if (parsed !== null) return parsed;
  }

  // Some gateways send an absolute epoch instead.
  for (const name of ['x-ratelimit-reset', 'ratelimit-reset']) {
    const raw = headers.get(name);
    if (!raw) continue;
    const num = Number(raw.trim());
    if (!Number.isFinite(num)) continue;
    // Values below ~1e9 are a delta in seconds, above are an epoch.
    const ms = num < 1_000_000_000 ? num * 1000 : num * 1000 - now;
    if (ms >= 0) return Math.round(ms);
  }
  return null;
}

/** Parses Go-style duration strings such as "6m0s" or "150ms". */
export function parseDurationString(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '') return null;

  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(trimmed)) !== null) {
    matched = true;
    const amount = Number(match[1]);
    switch (match[2]) {
      case 'ms':
        total += amount;
        break;
      case 's':
        total += amount * 1000;
        break;
      case 'm':
        total += amount * 60_000;
        break;
      case 'h':
        total += amount * 3_600_000;
        break;
    }
  }
  return matched ? Math.round(total) : null;
}

/** Markers that distinguish a hard quota exhaustion from a transient 429. */
const QUOTA_MARKERS = [
  'quota',
  'insufficient_quota',
  'billing',
  'credit balance',
  'exceeded your current quota',
  'resource_exhausted',
  'out of capacity',
];

/**
 * Classifies a non-2xx upstream response into an error class and scope.
 *
 * `bodyText` is read in full by the caller before this runs, because the
 * classification depends on the body for request-fault and quota detection.
 */
export function classifyHttpFailure(
  status: number,
  headers: Headers,
  bodyText: string,
  now = Date.now(),
): RouterError {
  const body = bodyText.slice(0, 4096);
  const lower = bodyText.toLowerCase();
  const retryAfterMs = parseResetMetadata(headers, now);

  if (isRequestFault(status, bodyText)) {
    return new RouterError({
      message: `upstream rejected the request (${status})`,
      errorClass: 'request_fault',
      scope: 'request',
      status,
      upstreamBody: body,
    });
  }

  if (status === 429 || status === 402) {
    const exhausted =
      status === 402 || QUOTA_MARKERS.some((marker) => lower.includes(marker));
    return new RouterError({
      message: exhausted
        ? `upstream quota exhausted (${status})`
        : `upstream rate limited (${status})`,
      errorClass: exhausted ? 'quota_exhausted' : 'rate_limit',
      scope: 'credential',
      status,
      retryAfterMs,
      upstreamBody: body,
    });
  }

  if (status === 401 || status === 403) {
    return new RouterError({
      message: `upstream rejected the credential (${status})`,
      errorClass: 'auth',
      scope: 'credential',
      status,
      retryAfterMs,
      upstreamBody: body,
    });
  }

  if (status >= 500) {
    return new RouterError({
      message: `upstream server error (${status})`,
      errorClass: 'server',
      scope: 'credential',
      status,
      retryAfterMs,
      upstreamBody: body,
    });
  }

  // Anything else non-2xx that is not a recognised request fault. Treated as
  // credential-scoped so the pool can route around a single odd upstream,
  // but it is logged as unknown so it shows up for investigation.
  return new RouterError({
    message: `unexpected upstream status ${status}`,
    errorClass: 'unknown',
    scope: 'credential',
    status,
    retryAfterMs,
    upstreamBody: body,
  });
}

/** Node/undici transport failure codes that mean "the connection broke". */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCodeOf(err: unknown): string | null {
  let node: unknown = err;
  for (let depth = 0; depth < 5 && node !== null && node !== undefined; depth += 1) {
    if (typeof node === 'object' && 'code' in node) {
      const code = (node as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    node = typeof node === 'object' ? (node as { cause?: unknown }).cause : null;
  }
  return null;
}

/**
 * Classifies a thrown transport error. `aborted` distinguishes our own timeout
 * abort from the downstream client disconnecting, which must never be charged
 * to the credential.
 */
export function classifyTransportError(
  err: unknown,
  opts: { timedOut?: boolean; clientAborted?: boolean } = {},
): RouterError {
  if (err instanceof RouterError) return err;

  if (opts.clientAborted) {
    return new RouterError({
      message: 'client closed the request',
      errorClass: 'cancelled',
      scope: 'client',
      status: STATUS_CLIENT_CLOSED_REQUEST,
      cause: err,
    });
  }

  if (opts.timedOut) {
    return new RouterError({
      message: 'upstream timed out',
      errorClass: 'timeout',
      scope: 'credential',
      status: 504,
      cause: err,
    });
  }

  const code = errorCodeOf(err);
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return new RouterError({
      message: 'upstream timed out',
      errorClass: 'timeout',
      scope: 'credential',
      status: 504,
      cause: err,
    });
  }
  if (code !== null && NETWORK_CODES.has(code)) {
    return new RouterError({
      message: `upstream connection failed (${code})`,
      errorClass: 'network',
      scope: 'credential',
      status: 502,
      cause: err,
    });
  }

  if (isClientCancellation(err)) {
    return new RouterError({
      message: 'client closed the request',
      errorClass: 'cancelled',
      scope: 'client',
      status: STATUS_CLIENT_CLOSED_REQUEST,
      cause: err,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new RouterError({
    message: `upstream request failed: ${message}`,
    errorClass: 'network',
    scope: 'credential',
    status: 502,
    cause: err,
  });
}

/**
 * Trims an upstream body down to something safe to show in a log line or the
 * dashboard: no control characters, bounded length.
 */
export function summarizeUpstreamError(raw: string | null, limit = 240): string | null {
  if (raw === null) return null;
  const parsed = parseJson(raw);
  let text = raw;
  if (parsed !== null && typeof parsed === 'object') {
    const message =
      readRawPath(parsed, 'error.message') ??
      readRawPath(parsed, 'message') ??
      readRawPath(parsed, 'error');
    if (message !== null) text = message;
  }
  // Control characters are stripped because summaries reach a plain-text log
  // where a CR/LF could otherwise forge a new log line.
  const cleaned = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.length > limit ? `${cleaned.slice(0, limit - 1)}…` : cleaned;
}

function readRawPath(root: unknown, path: string): string | null {
  let node: unknown = root;
  for (const segment of path.split('.')) {
    if (node === null || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === 'string' ? node : null;
}
