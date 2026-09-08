/**
 * Cooldown duration policy.
 *
 * Ported from CLIProxyAPI's nextQuotaCooldown / quotaCooldownAfterFailure. The
 * property worth preserving is that failures landing inside an already-open
 * cooldown window reuse that window instead of climbing the ladder again, so a
 * burst of concurrent in-flight failures advances the backoff at most once per
 * window rather than once per request.
 */

import type { ErrorClass } from '../../shared/types.js';

export interface BackoffPolicy {
  /** Base of the exponential ladder, in ms. */
  baseMs: number;
  /** Ceiling of the exponential ladder, in ms. */
  maxMs: number;
  /** Cooldown for 5xx / transport failures, in ms. */
  transientMs: number;
}

/** Nothing shorter than this, so a tight upstream loop cannot spin the pool. */
export const MIN_COOLDOWN_FLOOR_MS = 10_000;

export interface CooldownWindow {
  nextRetryAt: number;
  backoffLevel: number;
}

/**
 * Advances the exponential ladder one step.
 *
 * The level is only incremented while the resulting duration is still below the
 * ceiling; once it saturates the level is held, so the ladder cannot overflow
 * on a credential that keeps failing for hours.
 */
export function nextLadderStep(
  previousLevel: number,
  policy: BackoffPolicy,
): { durationMs: number; level: number } {
  const level = previousLevel < 0 ? 0 : previousLevel;
  // 2^30 already exceeds any sane ceiling; clamping keeps the shift defined.
  const shift = Math.min(level, 30);
  const raw = policy.baseMs * 2 ** shift;
  const duration = Math.max(raw, policy.baseMs);
  if (duration >= policy.maxMs) {
    return { durationMs: policy.maxMs, level };
  }
  return { durationMs: duration, level: level + 1 };
}

/**
 * Applies full jitter to a computed backoff.
 *
 * Full jitter (a uniform draw over [0, duration]) rather than the duration
 * itself, because several credentials that failed together would otherwise all
 * come back at the same instant and re-collide.
 *
 * The floor is applied after jitter so a jittered value cannot land below it.
 */
export function applyJitter(
  durationMs: number,
  random: () => number = Math.random,
): number {
  const jittered = Math.round(random() * durationMs);
  return Math.max(jittered, Math.min(MIN_COOLDOWN_FLOOR_MS, durationMs));
}

/**
 * Computes the cooldown window for a failure observed at `now`.
 *
 * An upstream-supplied Retry-After always wins over our own ladder: the
 * upstream knows its reset schedule and guessing shorter only earns another
 * 429. It is used verbatim without jitter, because it is an instruction rather
 * than an estimate.
 */
export function computeCooldown(input: {
  errorClass: ErrorClass;
  previous: CooldownWindow | null;
  retryAfterMs: number | null;
  policy: BackoffPolicy;
  now: number;
  random?: () => number;
}): CooldownWindow {
  const { previous, retryAfterMs, policy, now } = input;
  const previousLevel = previous?.backoffLevel ?? 0;

  // A failure that lands while the previous window is still open reuses it.
  // Without this, N concurrent in-flight requests failing together would each
  // advance the ladder and turn a 1s cooldown into 2^N.
  if (previous !== null && previous.nextRetryAt > now && retryAfterMs === null) {
    return previous;
  }

  if (retryAfterMs !== null) {
    return {
      nextRetryAt: now + Math.max(retryAfterMs, 0),
      // The ladder still advances so that repeated Retry-After responses which
      // stop arriving fall back to a longer local wait rather than to base.
      backoffLevel: Math.min(previousLevel + 1, 30),
    };
  }

  if (input.errorClass === 'server' || input.errorClass === 'network' || input.errorClass === 'timeout') {
    // Transient upstream faults get a flat window rather than the quota ladder;
    // they usually clear on their own and should not compound to 30 minutes.
    const step = nextLadderStep(previousLevel, {
      baseMs: policy.transientMs,
      maxMs: policy.maxMs,
      transientMs: policy.transientMs,
    });
    return {
      nextRetryAt: now + applyJitter(step.durationMs, input.random),
      backoffLevel: step.level,
    };
  }

  const step = nextLadderStep(previousLevel, policy);
  return {
    nextRetryAt: now + applyJitter(step.durationMs, input.random),
    backoffLevel: step.level,
  };
}

/**
 * Wait before the next retry round over the pool.
 *
 * Distinct from the credential cooldown above: this is how long the *request*
 * pauses when every credential is momentarily held, and it is capped hard so a
 * CLI never hangs for the length of a quota window.
 */
export function retryRoundDelay(
  attempt: number,
  maxIntervalMs: number,
  random: () => number = Math.random,
): number {
  const base = Math.min(200 * 2 ** Math.min(attempt, 10), maxIntervalMs);
  return Math.round(base / 2 + random() * (base / 2));
}
