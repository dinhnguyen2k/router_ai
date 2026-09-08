/**
 * Test harness.
 *
 * The fake upstream is a real HTTP server rather than a mocked fetch, so the
 * streaming tests exercise the actual socket behaviour the router has to cope
 * with: a connection reset mid-body, a stalled response, a 200 that never
 * produces a payload. Those are precisely the cases a fetch stub would let
 * through untested.
 */

import http from 'node:http';
import { AddressInfo } from 'node:net';
import { openDatabase, type Db } from '../server/db/index.js';
import { LogStore } from '../server/db/logs.js';
import { SettingsStore } from '../server/db/settings.js';
import { AccountPool } from '../server/core/pool.js';
import { RouterCore, type ResponseSink } from '../server/core/router.js';
import type { CreateAccountInput, RouterSettingsDto } from '../shared/types.js';

export const TEST_KEY = Buffer.alloc(32, 7);

export interface TestStack {
  db: Db;
  pool: AccountPool;
  logs: LogStore;
  settings: SettingsStore;
  core: RouterCore;
  close(): void;
}

export function createStack(overrides: Partial<RouterSettingsDto> = {}): TestStack {
  const db = openDatabase(':memory:');
  const logs = new LogStore(db);
  const settings = new SettingsStore(db);
  settings.update({
    // Tests must not sit through real backoff waits.
    maxRetryIntervalMs: 0,
    cooldownBaseMs: 1_000,
    upstreamTimeoutMs: 2_000,
    ...overrides,
  });
  const pool = new AccountPool(db, TEST_KEY);
  const core = new RouterCore(pool, settings, logs);
  core.applySettings();
  return { db, pool, logs, settings, core, close: () => db.close() };
}

/** Collects everything the router writes, and can simulate a client hang-up. */
export class MemorySink implements ResponseSink {
  status: number | null = null;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  ended = false;
  private closed = false;

  writeHead(status: number, headers: Record<string, string>): void {
    if (this.status !== null) throw new Error('writeHead called twice');
    this.status = status;
    this.headers = headers;
  }

  write(chunk: Uint8Array): void {
    if (!this.writable) return;
    this.chunks.push(Buffer.from(chunk));
  }

  end(): void {
    this.ended = true;
  }

  get writable(): boolean {
    return !this.ended && !this.closed;
  }

  /** Simulates the downstream client disconnecting mid-stream. */
  closeClient(): void {
    this.closed = true;
  }

  get body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

export type UpstreamHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
) => void | Promise<void>;

export interface FakeUpstream {
  baseUrl: string;
  /** One entry per request received, in order. */
  requests: Array<{ url: string; headers: http.IncomingHttpHeaders; body: string }>;
  close(): Promise<void>;
}

/**
 * Starts a fake upstream.
 *
 * `handlers` is consumed one entry per request so a test can script a sequence
 * such as "429, then 200"; once exhausted the last handler repeats.
 */
export async function startUpstream(handlers: UpstreamHandler[]): Promise<FakeUpstream> {
  const requests: FakeUpstream['requests'] = [];
  let index = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ url: req.url ?? '', headers: req.headers, body });
      const handler = handlers[Math.min(index, handlers.length - 1)];
      index += 1;
      void handler(req, res, body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

// --- Canned upstream behaviours ---------------------------------------------

export const upstream = {
  /** A complete OpenAI-style SSE stream. */
  stream(text = 'hello', opts: { usage?: boolean } = {}): UpstreamHandler {
    return (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      if (opts.usage === true) {
        res.write(
          `data: ${JSON.stringify({ usage: { prompt_tokens: 11, completion_tokens: 22 } })}\n\n`,
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    };
  },

  /** A non-streaming JSON response. */
  json(payload: unknown = { choices: [{ message: { content: 'hi' } }] }): UpstreamHandler {
    return (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
  },

  /** An error status with an optional body and headers. */
  error(
    status: number,
    body: unknown = { error: { message: 'upstream said no' } },
    headers: Record<string, string> = {},
  ): UpstreamHandler {
    return (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
  },

  /**
   * Sends a 200 and part of a stream, then destroys the socket.
   *
   * This is the partial-failure case: bytes have already been forwarded, so the
   * router must not fail over.
   */
  partialThenReset(text = 'partial'): UpstreamHandler {
    return (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
      setTimeout(() => {
        res.socket?.destroy();
      }, 30);
    };
  },

  /** A 200 whose body closes without ever producing a payload. */
  emptyStream(): UpstreamHandler {
    return (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end();
    };
  },

  /** Accepts the request and then never responds. */
  hang(): UpstreamHandler {
    return () => {
      /* deliberately no response */
    };
  },

  /** Delays the whole response by `ms`, then streams normally. */
  slowStream(ms: number, text = 'slow'): UpstreamHandler {
    return (_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      }, ms);
    };
  },
};

/** Adds an OpenAI-protocol account pointed at a fake upstream. */
export function addAccount(
  stack: TestStack,
  baseUrl: string,
  overrides: Partial<CreateAccountInput> = {},
): ReturnType<AccountPool['create']> {
  return stack.pool.create({
    name: overrides.name ?? `acct-${Math.random().toString(36).slice(2, 8)}`,
    provider: 'openai_compatible',
    apiKey: overrides.apiKey ?? 'sk-test-0123456789abcdef',
    baseUrl,
    models: overrides.models ?? ['test-model'],
    priority: overrides.priority,
    weight: overrides.weight,
    maxConcurrent: overrides.maxConcurrent,
    tags: overrides.tags,
  });
}

/** A minimal streaming route request against `test-model`. */
export function routeRequest(
  overrides: Partial<Parameters<RouterCore['route']>[0]> = {},
): Parameters<RouterCore['route']>[0] {
  return {
    protocol: 'openai',
    model: 'test-model',
    stream: true,
    body: Buffer.from(JSON.stringify({ model: 'test-model', stream: true })),
    passthroughHeaders: {},
    query: '',
    signal: new AbortController().signal,
    ...overrides,
  };
}
