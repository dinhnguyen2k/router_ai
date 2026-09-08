/**
 * Error classification.
 *
 * These assertions guard the rule that decides whether a credential is
 * penalized at all. Getting them wrong drains a healthy pool over a client-side
 * bug, or keeps hammering a dead key.
 */

import { describe, expect, it } from 'vitest';
import {
  classifyHttpFailure,
  classifyTransportError,
  isRequestFault,
  parseDurationString,
  parseRetryAfter,
  parseResetMetadata,
  summarizeUpstreamError,
} from '../server/core/errors.js';

describe('isRequestFault', () => {
  it('treats 400 as a request fault', () => {
    expect(isRequestFault(400, '')).toBe(true);
  });

  it('treats 413 and 422 as request faults', () => {
    expect(isRequestFault(413, '')).toBe(true);
    expect(isRequestFault(422, '')).toBe(true);
  });

  it('lets 429 win over an invalid_request_error body', () => {
    const body = JSON.stringify({ error: { type: 'invalid_request_error' } });
    expect(isRequestFault(429, body)).toBe(false);
  });

  it('lets 402 win over an invalid_request_error body', () => {
    const body = JSON.stringify({ error: { code: 'invalid_request_error' } });
    expect(isRequestFault(402, body)).toBe(false);
  });

  it('keeps 401 with an authentication_error body as a credential fault', () => {
    const body = JSON.stringify({ error: { type: 'authentication_error' } });
    expect(isRequestFault(401, body)).toBe(false);
  });

  it('detects a request fault from the body on an otherwise unremarkable status', () => {
    const body = JSON.stringify({ error: { code: 'context_length_exceeded' } });
    expect(isRequestFault(500, body)).toBe(true);
  });

  it('recognises the plain-text item-not-persisted 404', () => {
    const message =
      'Item with id msg_123 not found. Items are not persisted when `store` is set to false.';
    expect(isRequestFault(404, message)).toBe(true);
  });

  it('does not treat a plain 404 as a request fault', () => {
    expect(isRequestFault(404, '')).toBe(false);
  });
});

describe('classifyHttpFailure', () => {
  const noHeaders = new Headers();

  it('classifies a plain 429 as a retryable rate limit', () => {
    const err = classifyHttpFailure(429, noHeaders, '{}');
    expect(err.errorClass).toBe('rate_limit');
    expect(err.scope).toBe('credential');
    expect(err.retryable).toBe(true);
  });

  it('classifies a 429 mentioning quota as exhaustion', () => {
    const body = JSON.stringify({ error: { message: 'You exceeded your current quota' } });
    expect(classifyHttpFailure(429, noHeaders, body).errorClass).toBe('quota_exhausted');
  });

  it('classifies 402 as quota exhaustion regardless of body', () => {
    expect(classifyHttpFailure(402, noHeaders, '{}').errorClass).toBe('quota_exhausted');
  });

  it('classifies 401 and 403 as auth failures', () => {
    expect(classifyHttpFailure(401, noHeaders, '{}').errorClass).toBe('auth');
    expect(classifyHttpFailure(403, noHeaders, '{}').errorClass).toBe('auth');
  });

  it('classifies 5xx as a credential-scoped server error', () => {
    const err = classifyHttpFailure(503, noHeaders, '');
    expect(err.errorClass).toBe('server');
    expect(err.scope).toBe('credential');
  });

  it('marks a request fault as request-scoped and not retryable', () => {
    const err = classifyHttpFailure(400, noHeaders, '{}');
    expect(err.scope).toBe('request');
    expect(err.retryable).toBe(false);
  });

  it('carries Retry-After through to the error', () => {
    const headers = new Headers({ 'retry-after': '30' });
    expect(classifyHttpFailure(429, headers, '{}').retryAfterMs).toBe(30_000);
  });
});

describe('retry-after parsing', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('12')).toBe(12_000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const later = new Date(now + 45_000).toUTCString();
    expect(parseRetryAfter(later, now)).toBeGreaterThanOrEqual(44_000);
  });

  it('clamps a past date to zero rather than going negative', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const past = new Date(now - 60_000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it('returns null for nonsense', () => {
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('parses Go-style durations', () => {
    expect(parseDurationString('6m0s')).toBe(360_000);
    expect(parseDurationString('150ms')).toBe(150);
    expect(parseDurationString('1h30m')).toBe(5_400_000);
  });

  it('prefers retry-after over x-ratelimit-reset', () => {
    const headers = new Headers({
      'retry-after': '5',
      'x-ratelimit-reset-requests': '99s',
    });
    expect(parseResetMetadata(headers)).toBe(5_000);
  });

  it('falls back to x-ratelimit-reset-requests', () => {
    const headers = new Headers({ 'x-ratelimit-reset-requests': '2s' });
    expect(parseResetMetadata(headers)).toBe(2_000);
  });
});

describe('classifyTransportError', () => {
  it('maps a client abort to a client-scoped cancellation', () => {
    const err = classifyTransportError(new Error('boom'), { clientAborted: true });
    expect(err.errorClass).toBe('cancelled');
    expect(err.scope).toBe('client');
    expect(err.retryable).toBe(false);
  });

  it('maps a timeout to a credential-scoped timeout', () => {
    const err = classifyTransportError(new Error('boom'), { timedOut: true });
    expect(err.errorClass).toBe('timeout');
    expect(err.scope).toBe('credential');
  });

  it('maps ECONNRESET to a network error', () => {
    const cause = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
    const err = classifyTransportError(new Error('fetch failed', { cause }));
    expect(err.errorClass).toBe('network');
    expect(err.scope).toBe('credential');
  });
});

describe('summarizeUpstreamError', () => {
  it('pulls the message out of a structured body', () => {
    const body = JSON.stringify({ error: { message: 'rate limit reached' } });
    expect(summarizeUpstreamError(body)).toBe('rate limit reached');
  });

  it('strips control characters so a summary cannot forge a log line', () => {
    const summary = summarizeUpstreamError('bad\r\nlevel=fatal');
    expect(summary).toBe('bad level=fatal');
  });

  it('truncates long bodies', () => {
    const summary = summarizeUpstreamError('x'.repeat(1000), 50);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(50);
  });
});
