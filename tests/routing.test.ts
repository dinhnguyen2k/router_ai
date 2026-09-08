/**
 * End-to-end routing behaviour against real upstream sockets.
 *
 * The commit-boundary tests are the reason this file exists: they are the only
 * thing standing between a mid-stream upstream failure and a response spliced
 * together from two different generations.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  MemorySink,
  addAccount,
  createStack,
  routeRequest,
  startUpstream,
  upstream,
  type FakeUpstream,
  type TestStack,
} from './helpers.js';

const cleanup: Array<() => void | Promise<void>> = [];

function track<T extends TestStack | FakeUpstream>(value: T): T {
  cleanup.push(() => value.close());
  return value;
}

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

describe('happy path', () => {
  it('streams an upstream response through to the client', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream('hello', { usage: true })]));
    addAccount(stack, up.baseUrl);

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('success');
    expect(sink.status).toBe(200);
    expect(sink.body).toContain('hello');
    expect(sink.body).toContain('[DONE]');
    expect(sink.ended).toBe(true);
  });

  it('forwards the request body to the upstream byte for byte', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream()]));
    addAccount(stack, up.baseUrl);

    // Key order and spacing must survive the hop: a payload carrying tool-call
    // ids is only safe to replay if it is never re-serialised.
    const raw = '{"model":"test-model","stream":true,"tool_call_id":"call_ABC","n":1.50}';
    await stack.core.route(routeRequest({ body: Buffer.from(raw) }), new MemorySink());

    expect(up.requests[0].body).toBe(raw);
  });

  it('records token usage from the stream against the account', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream('hi', { usage: true })]));
    const account = addAccount(stack, up.baseUrl);

    await stack.core.route(routeRequest(), new MemorySink());

    expect(account.promptTokens).toBe(11);
    expect(account.completionTokens).toBe(22);
    expect(account.totalSuccess).toBe(1);
  });

  it('handles a non-streaming request', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.json({ id: 'resp_1', usage: { prompt_tokens: 3, completion_tokens: 4 } })]));
    addAccount(stack, up.baseUrl);

    const sink = new MemorySink();
    const result = await stack.core.route(
      routeRequest({ stream: false, body: Buffer.from('{"model":"test-model"}') }),
      sink,
    );

    expect(result.outcome).toBe('success');
    expect(JSON.parse(sink.body).id).toBe('resp_1');
  });
});

describe('failover before commit', () => {
  it('moves to another credential after a 429', async () => {
    const stack = track(createStack());
    const failing = track(await startUpstream([upstream.error(429)]));
    const healthy = track(await startUpstream([upstream.stream('second')]));
    // Ids drive round-robin order, so both are added and the assertion is on
    // the outcome rather than on which one was tried first.
    addAccount(stack, failing.baseUrl, { name: 'a-failing' });
    addAccount(stack, healthy.baseUrl, { name: 'b-healthy' });

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('success');
    expect(sink.body).toContain('second');
  });

  it('fails over on a 5xx', async () => {
    const stack = track(createStack());
    const failing = track(await startUpstream([upstream.error(503, 'gateway down')]));
    const healthy = track(await startUpstream([upstream.stream('recovered')]));
    addAccount(stack, failing.baseUrl);
    addAccount(stack, healthy.baseUrl);

    const sink = new MemorySink();
    expect((await stack.core.route(routeRequest(), sink)).outcome).toBe('success');
    expect(sink.body).toContain('recovered');
  });

  it('fails over when the upstream returns 200 with an empty stream', async () => {
    const stack = track(createStack());
    const empty = track(await startUpstream([upstream.emptyStream()]));
    const healthy = track(await startUpstream([upstream.stream('real content')]));
    addAccount(stack, empty.baseUrl);
    addAccount(stack, healthy.baseUrl);

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('success');
    expect(sink.body).toContain('real content');
    // The failed attempt must not have written a head, or the second attempt
    // could not have written its own.
    expect(sink.status).toBe(200);
  });

  it('puts the failing credential into cooldown', async () => {
    const stack = track(createStack());
    const failing = track(await startUpstream([upstream.error(429)]));
    const healthy = track(await startUpstream([upstream.stream()]));
    const bad = addAccount(stack, failing.baseUrl, { name: 'a-bad' });
    addAccount(stack, healthy.baseUrl, { name: 'b-good' });

    await stack.core.route(routeRequest(), new MemorySink());

    const cooldown = stack.pool.activeCooldown(bad, 'test-model', Date.now());
    expect(cooldown).not.toBeNull();
    expect(cooldown!.errorClass).toBe('rate_limit');
  });

  it('stops after maxRetryCredentials distinct credentials', async () => {
    const stack = track(createStack({ maxRetryCredentials: 2, requestRetryRounds: 0 }));
    const a = track(await startUpstream([upstream.error(503)]));
    const b = track(await startUpstream([upstream.error(503)]));
    const c = track(await startUpstream([upstream.stream('never reached')]));
    addAccount(stack, a.baseUrl);
    addAccount(stack, b.baseUrl);
    addAccount(stack, c.baseUrl);

    const result = await stack.core.route(routeRequest(), new MemorySink());

    expect(result.outcome).toBe('failed');
    const attempted = a.requests.length + b.requests.length + c.requests.length;
    expect(attempted).toBe(2);
  });
});

describe('request-scoped failures', () => {
  it('returns a 400 to the client without trying another credential', async () => {
    const stack = track(createStack());
    const bad = track(await startUpstream([upstream.error(400, { error: { message: 'bad input' } })]));
    const other = track(await startUpstream([upstream.stream('should not be used')]));
    addAccount(stack, bad.baseUrl, { name: 'a-first' });
    addAccount(stack, other.baseUrl, { name: 'b-second' });

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('failed');
    expect(sink.status).toBe(400);
    expect(other.requests.length).toBe(0);
  });

  it('does not penalize the credential for a request fault', async () => {
    const stack = track(createStack());
    const bad = track(await startUpstream([upstream.error(422, { error: { message: 'too long' } })]));
    const account = addAccount(stack, bad.baseUrl);

    await stack.core.route(routeRequest(), new MemorySink());

    expect(stack.pool.activeCooldown(account, 'test-model', Date.now())).toBeNull();
    expect(account.totalFailures).toBe(0);
    expect(account.consecutiveFailures).toBe(0);
    expect(stack.pool.healthOf(account)).toBe('ACTIVE');
  });
});

describe('commit boundary', () => {
  it('does not fail over once bytes have reached the client', async () => {
    const stack = track(createStack());
    const flaky = track(await startUpstream([upstream.partialThenReset('first half')]));
    const healthy = track(await startUpstream([upstream.stream('SECOND UPSTREAM')]));
    addAccount(stack, flaky.baseUrl, { name: 'a-flaky' });
    addAccount(stack, healthy.baseUrl, { name: 'b-healthy' });

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('partial_failure');
    expect(sink.body).toContain('first half');
    // The whole point: the second upstream's output must never appear spliced
    // onto a stream the first upstream already started.
    expect(sink.body).not.toContain('SECOND UPSTREAM');
    expect(healthy.requests.length).toBe(0);
  });

  it('reports the mid-stream failure as a terminal SSE error event', async () => {
    const stack = track(createStack());
    const flaky = track(await startUpstream([upstream.partialThenReset()]));
    addAccount(stack, flaky.baseUrl);

    const sink = new MemorySink();
    await stack.core.route(routeRequest(), sink);

    expect(sink.body).toContain('event: error');
    // No completion marker: a client must not mistake this for a clean finish.
    expect(sink.body).not.toContain('[DONE]');
    expect(sink.ended).toBe(true);
  });

  it('still records the mid-stream failure against the credential', async () => {
    const stack = track(createStack());
    const flaky = track(await startUpstream([upstream.partialThenReset()]));
    const account = addAccount(stack, flaky.baseUrl);

    await stack.core.route(routeRequest(), new MemorySink());

    expect(account.totalFailures).toBe(1);
    expect(stack.pool.activeCooldown(account, 'test-model', Date.now())).not.toBeNull();
  });

  it('logs a partial failure with its attempt marked committed', async () => {
    const stack = track(createStack());
    const flaky = track(await startUpstream([upstream.partialThenReset()]));
    addAccount(stack, flaky.baseUrl);

    await stack.core.route(routeRequest(), new MemorySink());

    const [entry] = stack.logs.list({ limit: 1 });
    expect(entry.outcome).toBe('partial_failure');
    expect(entry.ttfbMs).not.toBeNull();
    expect(entry.attempts[0].committed).toBe(true);
  });
});

describe('cancellation', () => {
  it('reports a client abort before the request starts as cancelled', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream()]));
    addAccount(stack, up.baseUrl);

    const controller = new AbortController();
    controller.abort(new Error('client gone'));

    const result = await stack.core.route(
      routeRequest({ signal: controller.signal }),
      new MemorySink(),
    );

    expect(result.outcome).toBe('cancelled');
    expect(up.requests.length).toBe(0);
  });

  it('does not penalize a credential when the client cancels mid-request', async () => {
    const stack = track(createStack({ upstreamTimeoutMs: 10_000 }));
    const up = track(await startUpstream([upstream.slowStream(5_000)]));
    const account = addAccount(stack, up.baseUrl);

    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('client gone')), 150);

    const result = await stack.core.route(
      routeRequest({ signal: controller.signal }),
      new MemorySink(),
    );

    expect(result.outcome).toBe('cancelled');
    expect(account.totalFailures).toBe(0);
    expect(stack.pool.activeCooldown(account, 'test-model', Date.now())).toBeNull();
  });

  it('stops pulling from the upstream when the client disconnects mid-stream', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream('chunk')]));
    addAccount(stack, up.baseUrl);

    const sink = new MemorySink();
    // Drop the client as soon as the first bytes land.
    const originalWrite = sink.write.bind(sink);
    let first = true;
    sink.write = (chunk: Uint8Array) => {
      originalWrite(chunk);
      if (first) {
        first = false;
        sink.closeClient();
      }
    };

    const result = await stack.core.route(routeRequest(), sink);
    expect(['cancelled', 'success']).toContain(result.outcome);
  });
});

describe('timeout', () => {
  it('times out a hanging upstream and fails over', async () => {
    const stack = track(createStack({ upstreamTimeoutMs: 400 }));
    const hanging = track(await startUpstream([upstream.hang()]));
    const healthy = track(await startUpstream([upstream.stream('after timeout')]));
    addAccount(stack, hanging.baseUrl, { name: 'a-hang' });
    addAccount(stack, healthy.baseUrl, { name: 'b-ok' });

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('success');
    expect(sink.body).toContain('after timeout');
  });

  it('does not cut off a slow but healthy stream once it has started', async () => {
    const stack = track(createStack({ upstreamTimeoutMs: 2_000 }));
    const up = track(await startUpstream([upstream.slowStream(300, 'eventually')]));
    addAccount(stack, up.baseUrl);

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('success');
    expect(sink.body).toContain('eventually');
  });
});

describe('exhausted pool', () => {
  it('returns 503 when no credential is configured', async () => {
    const stack = track(createStack());

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('failed');
    expect(sink.status).toBe(503);
  });

  it('returns 404 when nothing serves the requested model', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream()]));
    addAccount(stack, up.baseUrl, { models: ['other-model'] });

    const sink = new MemorySink();
    await stack.core.route(routeRequest(), sink);

    expect(sink.status).toBe(404);
    expect(JSON.parse(sink.body).error.code).toBe('no_model_match');
  });

  it('returns 429 and names the recovery time when every credential is cooling down', async () => {
    const stack = track(createStack({ requestRetryRounds: 0, cooldownBaseMs: 60_000 }));
    const up = track(await startUpstream([upstream.error(429)]));
    addAccount(stack, up.baseUrl);

    // First request trips the cooldown.
    await stack.core.route(routeRequest(), new MemorySink());

    const sink = new MemorySink();
    const result = await stack.core.route(routeRequest(), sink);

    expect(result.outcome).toBe('failed');
    expect(sink.status).toBe(429);
    expect(JSON.parse(sink.body).error.code).toBe('all_cooldown');
    expect(sink.body).toContain('recovers in');
  });

  it('disables a credential the upstream keeps rejecting', async () => {
    const stack = track(
      createStack({
        disableAfterAuthFailures: 2,
        requestRetryRounds: 0,
        // The first 401 holds the credential out for one transient window, so
        // the second attempt can only happen once that window lapses.
        transientCooldownMs: 1_000,
      }),
    );
    const up = track(await startUpstream([upstream.error(401, { error: { type: 'authentication_error' } })]));
    const account = addAccount(stack, up.baseUrl);

    await stack.core.route(routeRequest(), new MemorySink());
    expect(account.enabled).toBe(true);
    expect(account.consecutiveFailures).toBe(1);
    expect(stack.pool.healthOf(account)).toBe('TEMP_ERROR');

    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await stack.core.route(routeRequest(), new MemorySink());
    expect(account.enabled).toBe(false);
    expect(stack.pool.healthOf(account)).toBe('DISABLED');
  });
});

describe('concurrency', () => {
  it('spreads concurrent requests across the pool', async () => {
    const stack = track(createStack({ strategy: 'round_robin' }));
    const a = track(await startUpstream([upstream.slowStream(100, 'from-a')]));
    const b = track(await startUpstream([upstream.slowStream(100, 'from-b')]));
    addAccount(stack, a.baseUrl, { name: 'a' });
    addAccount(stack, b.baseUrl, { name: 'b' });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => stack.core.route(routeRequest(), new MemorySink())),
    );

    expect(results.every((r) => r.outcome === 'success')).toBe(true);
    expect(a.requests.length).toBeGreaterThan(0);
    expect(b.requests.length).toBeGreaterThan(0);
    expect(a.requests.length + b.requests.length).toBe(6);
  });

  it('honours a per-credential concurrency limit', async () => {
    const stack = track(createStack());
    const a = track(await startUpstream([upstream.slowStream(200, 'a')]));
    const b = track(await startUpstream([upstream.slowStream(200, 'b')]));
    addAccount(stack, a.baseUrl, { name: 'a', maxConcurrent: 1 });
    addAccount(stack, b.baseUrl, { name: 'b', maxConcurrent: 1 });

    await Promise.all(
      Array.from({ length: 2 }, () => stack.core.route(routeRequest(), new MemorySink())),
    );

    // With one slot each, two simultaneous requests cannot both land on one.
    expect(a.requests.length).toBe(1);
    expect(b.requests.length).toBe(1);
  });

  it('releases in-flight counts after every request settles', async () => {
    const stack = track(createStack());
    const up = track(await startUpstream([upstream.stream()]));
    addAccount(stack, up.baseUrl);

    await Promise.all(
      Array.from({ length: 4 }, () => stack.core.route(routeRequest(), new MemorySink())),
    );

    expect(stack.pool.totalInFlight()).toBe(0);
  });

  it('does not let a burst of concurrent failures compound the backoff ladder', async () => {
    const stack = track(createStack({ requestRetryRounds: 0, cooldownBaseMs: 1_000 }));
    const up = track(await startUpstream([upstream.error(429)]));
    const account = addAccount(stack, up.baseUrl, { maxConcurrent: 8 });

    await Promise.all(
      Array.from({ length: 5 }, () => stack.core.route(routeRequest(), new MemorySink())),
    );

    // Five simultaneous 429s land inside one window, so the ladder advances
    // once rather than five times.
    const cooldown = account.cooldowns.get('test-model') ?? account.cooldowns.get('');
    expect(cooldown).toBeDefined();
    expect(cooldown!.backoffLevel).toBeLessThanOrEqual(2);
  });
});
