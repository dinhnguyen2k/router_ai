/**
 * Pool state, selection strategies, cooldown persistence, and the concurrency
 * gate — the parts that decide which credential a request lands on and for how
 * long a failing one stays out of rotation.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/index.js';
import { AccountPool } from '../server/core/pool.js';
import { Selector, eligibleCandidates } from '../server/core/selector.js';
import { Semaphore, sleep } from '../server/core/concurrency.js';
import { applyJitter, computeCooldown, nextLadderStep } from '../server/core/backoff.js';
import { RouterError } from '../server/core/errors.js';
import { encryptSecret, decryptSecret, maskSecret } from '../server/core/crypto.js';
import { normalizeSettings } from '../server/db/settings.js';
import { createStack, TEST_KEY, type TestStack } from './helpers.js';

const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn();
});

function stack(): TestStack {
  const created = createStack();
  cleanup.push(() => created.close());
  return created;
}

const POLICY = { baseMs: 1_000, maxMs: 30 * 60_000, transientMs: 60_000 };

function add(
  s: TestStack,
  name: string,
  overrides: { priority?: number; weight?: number; models?: string[]; maxConcurrent?: number } = {},
) {
  return s.pool.create({
    name,
    provider: 'openai_compatible',
    apiKey: `sk-${name}-0123456789`,
    baseUrl: 'http://127.0.0.1:1/v1',
    models: overrides.models ?? ['test-model'],
    priority: overrides.priority,
    weight: overrides.weight,
    maxConcurrent: overrides.maxConcurrent,
  });
}

function candidates(s: TestStack, model = 'test-model') {
  return eligibleCandidates(s.pool, {
    protocol: 'openai',
    model,
    exclude: new Set<string>(),
    now: Date.now(),
  });
}

// ---------------------------------------------------------------------------

describe('credential storage', () => {
  it('round-trips an encrypted key', () => {
    const cipher = encryptSecret('sk-secret-value', TEST_KEY);
    expect(cipher).not.toContain('sk-secret-value');
    expect(decryptSecret(cipher, TEST_KEY)).toBe('sk-secret-value');
  });

  it('refuses to decrypt under a different key', () => {
    const cipher = encryptSecret('sk-secret-value', TEST_KEY);
    expect(() => decryptSecret(cipher, Buffer.alloc(32, 9))).toThrow();
  });

  it('fully redacts short keys rather than revealing most of them', () => {
    expect(maskSecret('sk-short')).toBe('••••••••');
    expect(maskSecret('sk-proj-abcdefghijklmnop')).toBe('sk-pro…mnop');
  });

  it('never exposes the key in an account DTO', () => {
    const s = stack();
    const account = add(s, 'a');
    const dto = s.pool.toDto(account);
    expect(JSON.stringify(dto)).not.toContain('sk-a-0123456789');
    expect(dto.apiKeyMasked).toBeTruthy();
  });
});

describe('model matching', () => {
  it('matches a credential that declares the model', () => {
    const s = stack();
    add(s, 'a', { models: ['gemini-2.5-pro'] });
    expect(candidates(s, 'gemini-2.5-pro').candidates.length).toBe(1);
  });

  it('accepts a Gemini-style models/ prefix', () => {
    const s = stack();
    add(s, 'a', { models: ['gemini-2.5-pro'] });
    expect(candidates(s, 'models/gemini-2.5-pro').candidates.length).toBe(1);
  });

  it('treats a credential with no declared models as serving anything', () => {
    const s = stack();
    add(s, 'a', { models: [] });
    expect(candidates(s, 'whatever-model').candidates.length).toBe(1);
  });

  it('reports no_model_match when nothing declares the model', () => {
    const s = stack();
    add(s, 'a', { models: ['other'] });
    expect(candidates(s, 'test-model').reason?.kind).toBe('no_model_match');
  });

  it('never mixes protocols', () => {
    const s = stack();
    s.pool.create({
      name: 'gemini',
      provider: 'gemini',
      apiKey: 'AIza-0123456789abc',
      models: ['test-model'],
    });
    // The pool has a credential serving this model, but on the other protocol.
    expect(candidates(s, 'test-model').reason?.kind).toBe('no_model_match');
  });
});

describe('priority tiers', () => {
  it('only offers the highest available tier', () => {
    const s = stack();
    add(s, 'p1', { priority: 1 });
    add(s, 'p2', { priority: 2 });
    const { candidates: list } = candidates(s);
    expect(list.map((a) => a.name)).toEqual(['p1']);
  });

  it('falls through to the next tier when the top one is unavailable', () => {
    const s = stack();
    const p1 = add(s, 'p1', { priority: 1 });
    add(s, 'p2', { priority: 2 });
    s.pool.forceCooldown(p1.id, 60_000, 'held');
    expect(candidates(s).candidates.map((a) => a.name)).toEqual(['p2']);
  });
});

describe('selection strategies', () => {
  it('round-robin rotates through every credential', () => {
    const s = stack();
    add(s, 'a');
    add(s, 'b');
    add(s, 'c');
    const selector = new Selector('round_robin');
    const list = candidates(s).candidates;

    const picks = Array.from({ length: 6 }, () => selector.select(list, 'ring').name);
    expect(new Set(picks).size).toBe(3);
    // Each credential gets an equal share over a whole number of cycles.
    expect(picks.filter((n) => n === 'a').length).toBe(2);
    expect(picks.filter((n) => n === 'b').length).toBe(2);
    expect(picks.filter((n) => n === 'c').length).toBe(2);
  });

  it('round-robin does not starve a credential when one drops out mid-rotation', () => {
    const s = stack();
    const a = add(s, 'a');
    add(s, 'b');
    add(s, 'c');
    const selector = new Selector('round_robin');

    selector.select(candidates(s).candidates, 'ring');
    s.pool.forceCooldown(a.id, 60_000, 'held');
    selector.select(candidates(s).candidates, 'ring');
    s.pool.clearCooldown(a.id);

    const picks = Array.from({ length: 6 }, () =>
      selector.select(candidates(s).candidates, 'ring').name,
    );
    expect(picks).toContain('a');
  });

  it('least_used prefers the credential with the fewest in-flight requests', () => {
    const s = stack();
    const a = add(s, 'a');
    add(s, 'b');
    s.pool.acquire(a);
    s.pool.acquire(a);

    const selector = new Selector('least_used');
    expect(selector.select(candidates(s).candidates, 'ring').name).toBe('b');
  });

  it('weighted_priority distributes roughly in proportion to weight', () => {
    const s = stack();
    add(s, 'heavy', { weight: 80 });
    add(s, 'light', { weight: 20 });
    const selector = new Selector('weighted_priority');
    const list = candidates(s).candidates;

    const picks = Array.from({ length: 100 }, () => selector.select(list, 'ring').name);
    const heavy = picks.filter((n) => n === 'heavy').length;
    expect(heavy).toBeGreaterThan(70);
    expect(heavy).toBeLessThan(90);
  });

  it('failover_cascade keeps returning the same credential', () => {
    const s = stack();
    add(s, 'primary', { weight: 90 });
    add(s, 'backup', { weight: 10 });
    const selector = new Selector('failover_cascade');
    const list = candidates(s).candidates;

    const picks = Array.from({ length: 5 }, () => selector.select(list, 'ring').name);
    expect(new Set(picks)).toEqual(new Set(['primary']));
  });

  it('failover_cascade moves to the backup once the primary is unavailable', () => {
    const s = stack();
    const primary = add(s, 'primary', { weight: 90 });
    add(s, 'backup', { weight: 10 });
    const selector = new Selector('failover_cascade');

    expect(selector.select(candidates(s).candidates, 'ring').name).toBe('primary');
    s.pool.forceCooldown(primary.id, 60_000, 'held');
    expect(selector.select(candidates(s).candidates, 'ring').name).toBe('backup');
  });
});

describe('cooldown', () => {
  it('holds a credential out of rotation until the window lapses', () => {
    const s = stack();
    const a = add(s, 'a');
    s.pool.forceCooldown(a.id, 60_000, 'rate limited');

    expect(s.pool.healthOf(a)).toBe('COOLDOWN');
    expect(candidates(s).reason?.kind).toBe('all_cooldown');
  });

  it('scopes a rate limit to the model that hit it', () => {
    const s = stack();
    const a = add(s, 'a', { models: ['model-x', 'model-y'] });
    s.pool.recordFailure({
      account: a,
      model: 'model-x',
      error: new RouterError({
        message: 'rate limited',
        errorClass: 'rate_limit',
        scope: 'credential',
        status: 429,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });

    expect(s.pool.activeCooldown(a, 'model-x', Date.now())).not.toBeNull();
    // The other model is untouched: a per-model limit must not idle the whole
    // credential.
    expect(s.pool.activeCooldown(a, 'model-y', Date.now())).toBeNull();
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
  });

  it('applies a server error to the whole credential', () => {
    const s = stack();
    const a = add(s, 'a', { models: ['model-x', 'model-y'] });
    s.pool.recordFailure({
      account: a,
      model: 'model-x',
      error: new RouterError({
        message: 'boom',
        errorClass: 'server',
        scope: 'credential',
        status: 502,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });

    expect(s.pool.healthOf(a)).toBe('TEMP_ERROR');
    expect(s.pool.activeCooldown(a, 'model-y', Date.now())).not.toBeNull();
  });

  it('honours Retry-After verbatim instead of the local ladder', () => {
    const now = Date.now();
    const window = computeCooldown({
      errorClass: 'rate_limit',
      previous: null,
      retryAfterMs: 45_000,
      policy: POLICY,
      now,
      random: () => 0.5,
    });
    expect(window.nextRetryAt).toBe(now + 45_000);
  });

  it('reuses an open window instead of climbing the ladder again', () => {
    const now = Date.now();
    const previous = { nextRetryAt: now + 30_000, backoffLevel: 3 };
    const window = computeCooldown({
      errorClass: 'rate_limit',
      previous,
      retryAfterMs: null,
      policy: POLICY,
      now,
      random: () => 0.5,
    });
    expect(window).toEqual(previous);
  });

  it('climbs the ladder once the previous window has lapsed', () => {
    const now = Date.now();
    const previous = { nextRetryAt: now - 1, backoffLevel: 2 };
    const window = computeCooldown({
      errorClass: 'rate_limit',
      previous,
      retryAfterMs: null,
      policy: POLICY,
      now,
      random: () => 1,
    });
    expect(window.backoffLevel).toBe(3);
    expect(window.nextRetryAt).toBe(now + 4_000);
  });

  it('saturates the ladder at the ceiling without overflowing the level', () => {
    const step = nextLadderStep(60, POLICY);
    expect(step.durationMs).toBe(POLICY.maxMs);
    expect(step.level).toBe(60);
  });

  it('never jitters below the floor', () => {
    expect(applyJitter(60_000, () => 0)).toBe(10_000);
  });

  it('does not let jitter exceed a short duration', () => {
    expect(applyJitter(3_000, () => 0)).toBe(3_000);
  });

  it('clears a self-inflicted cooldown on the next success', () => {
    const s = stack();
    const a = add(s, 'a');
    s.pool.recordFailure({
      account: a,
      model: 'test-model',
      error: new RouterError({
        message: 'boom',
        errorClass: 'server',
        scope: 'credential',
        status: 502,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });
    expect(s.pool.healthOf(a)).toBe('TEMP_ERROR');

    s.pool.recordSuccess(a);
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
  });

  it('leaves an upstream-declared window in place after a success', () => {
    const s = stack();
    const a = add(s, 'a');
    s.pool.forceCooldown(a.id, 60_000, 'rate limited');
    s.pool.recordSuccess(a);
    // The upstream may still be counting the window even though one call got
    // through, so a COOLDOWN is not cleared by a success.
    expect(s.pool.healthOf(a)).toBe('COOLDOWN');
  });

  it('does not penalize a credential for a request-scoped failure', () => {
    const s = stack();
    const a = add(s, 'a');
    s.pool.recordFailure({
      account: a,
      model: 'test-model',
      error: new RouterError({
        message: 'bad input',
        errorClass: 'request_fault',
        scope: 'request',
        status: 400,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
    expect(a.totalFailures).toBe(0);
    expect(a.totalRequests).toBe(1);
  });
});

describe('cooldown persistence', () => {
  it('survives a restart', () => {
    const db = openDatabase(':memory:');
    cleanup.push(() => db.close());

    const first = new AccountPool(db, TEST_KEY);
    const account = first.create({
      name: 'a',
      provider: 'openai_compatible',
      apiKey: 'sk-persist-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
      models: ['test-model'],
    });
    first.forceCooldown(account.id, 60_000, 'rate limited by upstream');
    const expected = account.cooldowns.get('')!.nextRetryAt;

    // A second pool over the same database stands in for a process restart.
    const reloaded = new AccountPool(db, TEST_KEY);
    const restored = reloaded.get(account.id);

    expect(restored).toBeDefined();
    expect(reloaded.healthOf(restored!)).toBe('COOLDOWN');
    expect(restored!.cooldowns.get('')!.nextRetryAt).toBe(expected);
    expect(restored!.cooldowns.get('')!.reason).toBe('rate limited by upstream');
  });

  it('does not restore a window that has already lapsed', () => {
    const db = openDatabase(':memory:');
    cleanup.push(() => db.close());

    const first = new AccountPool(db, TEST_KEY);
    const account = first.create({
      name: 'a',
      provider: 'openai_compatible',
      apiKey: 'sk-persist-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    first.forceCooldown(account.id, -1_000, 'already over');

    const reloaded = new AccountPool(db, TEST_KEY);
    // The row is still there, but health is derived from the clock, so an
    // expired window needs no sweeper to stop blocking.
    expect(reloaded.healthOf(reloaded.get(account.id)!)).toBe('ACTIVE');
  });

  it('keeps a disabled credential visible but unusable after reload', () => {
    const db = openDatabase(':memory:');
    cleanup.push(() => db.close());

    const first = new AccountPool(db, TEST_KEY);
    const account = first.create({
      name: 'a',
      provider: 'openai_compatible',
      apiKey: 'sk-persist-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    first.update(account.id, { enabled: false });

    const reloaded = new AccountPool(db, TEST_KEY);
    expect(reloaded.healthOf(reloaded.get(account.id)!)).toBe('DISABLED');
  });

  it('surfaces a credential it cannot decrypt instead of dropping it', () => {
    const db = openDatabase(':memory:');
    cleanup.push(() => db.close());

    const first = new AccountPool(db, TEST_KEY);
    first.create({
      name: 'a',
      provider: 'openai_compatible',
      apiKey: 'sk-persist-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
    });

    // Standing in for ROUTER_SECRET having changed.
    const reloaded = new AccountPool(db, Buffer.alloc(32, 3));
    const [account] = reloaded.all();
    expect(account).toBeDefined();
    expect(reloaded.healthOf(account)).toBe('DISABLED');
    expect(account.lastError).toContain('could not be decrypted');
  });

  it('clears every cooldown across the pool at once', () => {
    const s = stack();
    const a = add(s, 'a');
    const b = add(s, 'b');
    s.pool.forceCooldown(a.id, 60_000, 'x');
    s.pool.forceCooldown(b.id, 60_000, 'y');

    expect(s.pool.clearAllCooldowns()).toBe(2);
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
    expect(s.pool.healthOf(b)).toBe('ACTIVE');
  });
});

describe('concurrency', () => {
  it('reports saturation rather than cooldown when a credential is at its limit', () => {
    const s = stack();
    const a = add(s, 'a', { maxConcurrent: 1 });
    s.pool.acquire(a);
    expect(candidates(s).reason?.kind).toBe('all_saturated');
  });

  it('queues past the semaphore limit and drains in order', async () => {
    const gate = new Semaphore(2);
    await gate.acquire();
    await gate.acquire();
    expect(gate.inUse).toBe(2);

    let third = false;
    const pending = gate.acquire().then(() => {
      third = true;
    });
    expect(third).toBe(false);

    gate.release();
    await pending;
    expect(third).toBe(true);
  });

  it('drops an aborted waiter out of the queue', async () => {
    const gate = new Semaphore(1);
    await gate.acquire();

    const controller = new AbortController();
    const pending = gate.acquire(controller.signal);
    expect(gate.queued).toBe(1);

    controller.abort(new Error('client gone'));
    await expect(pending).rejects.toThrow();
    expect(gate.queued).toBe(0);
  });

  it('resizes without cancelling in-flight work', async () => {
    const gate = new Semaphore(1);
    await gate.acquire();
    gate.resize(3);
    await gate.acquire();
    await gate.acquire();
    expect(gate.inUse).toBe(3);
  });

  it('wakes a sleep early when the request is cancelled', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(new Error('cancelled')), 20);
    await expect(sleep(5_000, controller.signal)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('settings validation', () => {
  it('clamps out-of-range values rather than rejecting the whole payload', () => {
    const settings = normalizeSettings({
      strategy: 'nonsense',
      maxRetryCredentials: 9_999,
      maxGlobalConcurrency: -5,
    });
    expect(settings.strategy).toBe('round_robin');
    expect(settings.maxRetryCredentials).toBe(20);
    expect(settings.maxGlobalConcurrency).toBe(1);
  });

  it('accepts a valid strategy', () => {
    expect(normalizeSettings({ strategy: 'least_used' }).strategy).toBe('least_used');
  });
});

describe('daily token budget', () => {
  it('holds a credential out once its declared budget is spent', () => {
    const s = stack();
    const a = s.pool.create({
      name: 'budgeted',
      provider: 'openai_compatible',
      apiKey: 'sk-budget-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
      models: ['test-model'],
      dailyTokenBudget: 1_000,
    });

    s.pool.recordSuccess(a, { promptTokens: 600, completionTokens: 300 });
    expect(s.pool.budgetExhausted(a)).toBe(false);
    expect(s.pool.healthOf(a)).toBe('ACTIVE');

    s.pool.recordSuccess(a, { promptTokens: 100, completionTokens: 100 });
    expect(s.pool.budgetExhausted(a)).toBe(true);
    expect(s.pool.healthOf(a)).toBe('COOLDOWN');
    expect(candidates(s).reason?.kind).toBe('all_cooldown');
  });

  it('treats a zero budget as no cap at all', () => {
    const s = stack();
    const a = add(s, 'a');
    s.pool.recordSuccess(a, { promptTokens: 10_000_000, completionTokens: 0 });
    expect(s.pool.budgetExhausted(a)).toBe(false);
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
  });

  it('rolls the counters over when the UTC day changes', () => {
    const s = stack();
    const a = s.pool.create({
      name: 'budgeted',
      provider: 'openai_compatible',
      apiKey: 'sk-budget-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
      dailyTokenBudget: 1_000,
    });
    s.pool.recordSuccess(a, { promptTokens: 1_000, completionTokens: 0 });
    expect(s.pool.budgetExhausted(a)).toBe(true);

    // Stand in for the router still running past midnight UTC.
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000;
    expect(s.pool.budgetExhausted(a, tomorrow)).toBe(false);
    expect(a.todayTokens).toBe(0);
  });

  it('persists the daily counters across a restart', () => {
    const db = openDatabase(':memory:');
    cleanup.push(() => db.close());

    const first = new AccountPool(db, TEST_KEY);
    const account = first.create({
      name: 'budgeted',
      provider: 'openai_compatible',
      apiKey: 'sk-budget-0123456789',
      baseUrl: 'http://127.0.0.1:1/v1',
      dailyTokenBudget: 1_000,
    });
    first.recordSuccess(account, { promptTokens: 900, completionTokens: 0 });

    const reloaded = new AccountPool(db, TEST_KEY);
    const restored = reloaded.get(account.id)!;
    expect(restored.todayTokens).toBe(900);
    expect(restored.dailyTokenBudget).toBe(1_000);
  });
});

describe('health aggregation across models', () => {
  it('reports COOLDOWN when the credential\'s only model is held', () => {
    const s = stack();
    const a = add(s, 'single', { models: ['only-model'] });
    s.pool.recordFailure({
      account: a,
      model: 'only-model',
      error: new RouterError({
        message: 'rate limited',
        errorClass: 'rate_limit',
        scope: 'credential',
        status: 429,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });

    // The hold is stored per model, but nothing else is left to serve, so the
    // credential as a whole is unavailable.
    expect(s.pool.healthOf(a)).toBe('COOLDOWN');
    expect(s.pool.toDto(a).nextRetryAt).not.toBeNull();
  });

  it('stays ACTIVE while another declared model is still free', () => {
    const s = stack();
    const a = add(s, 'multi', { models: ['model-x', 'model-y'] });
    s.pool.recordFailure({
      account: a,
      model: 'model-x',
      error: new RouterError({
        message: 'rate limited',
        errorClass: 'rate_limit',
        scope: 'credential',
        status: 429,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });

    expect(s.pool.healthOf(a)).toBe('ACTIVE');
    expect(candidates(s, 'model-y').candidates.length).toBe(1);
    expect(candidates(s, 'model-x').reason?.kind).toBe('all_cooldown');
  });

  it('reports COOLDOWN once every declared model is held', () => {
    const s = stack();
    const a = add(s, 'multi', { models: ['model-x', 'model-y'] });
    for (const model of ['model-x', 'model-y']) {
      s.pool.recordFailure({
        account: a,
        model,
        error: new RouterError({
          message: 'rate limited',
          errorClass: 'rate_limit',
          scope: 'credential',
          status: 429,
        }),
        policy: POLICY,
        disableAfterAuthFailures: 3,
      });
    }
    expect(s.pool.healthOf(a)).toBe('COOLDOWN');
  });

  it('never judges a wildcard credential by per-model holds', () => {
    const s = stack();
    const a = add(s, 'wildcard', { models: [] });
    s.pool.recordFailure({
      account: a,
      model: 'some-model',
      error: new RouterError({
        message: 'rate limited',
        errorClass: 'rate_limit',
        scope: 'credential',
        status: 429,
      }),
      policy: POLICY,
      disableAfterAuthFailures: 3,
    });

    // It accepts models we have no record of, so one held model says nothing
    // about the credential overall.
    expect(s.pool.healthOf(a)).toBe('ACTIVE');
  });
});
