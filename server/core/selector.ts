/**
 * Credential selection.
 *
 * Candidates are gathered by priority tier first: only the highest tier with an
 * available credential is considered, so a P1 pool is never bypassed while it
 * still has capacity. Within a tier the configured strategy decides.
 *
 * Ported from CLIProxyAPI's selector.go, including the detail that round-robin
 * resumes by sorted id rather than by index — with an index, filtering a
 * cooled-down credential out of the candidate list silently shifts the rotation
 * and can starve one account.
 */

import type { SelectionStrategy } from '../../shared/types.js';
import { AccountPool, type PoolAccount } from './pool.js';

export interface SelectionRequest {
  protocol: string;
  model: string;
  /** Credentials already tried on this request; never handed out again. */
  exclude: ReadonlySet<string>;
  now: number;
}

export interface NoCandidateReason {
  kind: 'empty_pool' | 'all_excluded' | 'all_cooldown' | 'all_saturated' | 'no_model_match';
  /** Earliest moment a cooldown lifts, when that is what is blocking. */
  earliestRetryAt: number | null;
}

/**
 * Chooses one credential from a sorted candidate list.
 *
 * Kept separate from candidate collection so the strategies stay testable
 * without a pool, and so a future strategy cannot accidentally widen the
 * eligibility rules.
 */
export class Selector {
  /** Last pick per (protocol:model) ring, for round-robin. */
  private readonly lastPicked = new Map<string, string>();
  /** Accumulated credits per (protocol:model) ring, for smooth weighting. */
  private readonly weightCredits = new Map<string, Map<string, number>>();

  constructor(private strategy: SelectionStrategy) {}

  setStrategy(strategy: SelectionStrategy): void {
    if (strategy === this.strategy) return;
    this.strategy = strategy;
    // Credits earned under one strategy mean nothing under another.
    this.weightCredits.clear();
    this.lastPicked.clear();
  }

  getStrategy(): SelectionStrategy {
    return this.strategy;
  }

  select(candidates: PoolAccount[], ringKey: string): PoolAccount {
    if (candidates.length === 1) return candidates[0];
    switch (this.strategy) {
      case 'round_robin':
        return this.roundRobin(candidates, ringKey);
      case 'least_used':
        return leastUsed(candidates);
      case 'weighted_priority':
        return this.smoothWeighted(candidates, ringKey);
      case 'failover_cascade':
        return failoverCascade(candidates);
    }
  }

  /**
   * Resumes the ring at the credential whose id sorts after the previous pick.
   *
   * Candidates arrive id-sorted, so this survives a credential dropping out of
   * the list between calls: an index-based cursor would jump to a different
   * account and could keep skipping the same one.
   */
  private roundRobin(candidates: PoolAccount[], ringKey: string): PoolAccount {
    const last = this.lastPicked.get(ringKey);
    let index = 0;
    if (last !== undefined) {
      index = candidates.findIndex((account) => account.id > last);
      if (index === -1) index = 0;
    }
    const picked = candidates[index];
    this.lastPicked.set(ringKey, picked.id);
    return picked;
  }

  /**
   * Smooth weighted round-robin.
   *
   * Credits are kept across calls and only reset when a configured weight
   * actually changes. Resetting them whenever the candidate set shrinks — which
   * happens on every cooldown and every retry exclusion — would collapse
   * selection onto whichever credential sorts first.
   */
  private smoothWeighted(candidates: PoolAccount[], ringKey: string): PoolAccount {
    let credits = this.weightCredits.get(ringKey);
    if (credits === undefined) {
      credits = new Map();
      this.weightCredits.set(ringKey, credits);
    }

    const weights = candidates.map((account) => Math.max(1, account.weight));
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let best = candidates[0];
    let bestCredit = -Infinity;
    candidates.forEach((account, i) => {
      const next = (credits.get(account.id) ?? 0) + weights[i];
      credits.set(account.id, next);
      if (next > bestCredit) {
        bestCredit = next;
        best = account;
      }
    });
    credits.set(best.id, (credits.get(best.id) ?? 0) - total);

    // Drop credits for credentials that are no longer configured at all, but
    // only once the map has grown well past any real pool size.
    if (credits.size > 512) {
      const live = new Set(candidates.map((account) => account.id));
      for (const id of [...credits.keys()]) {
        if (!live.has(id)) credits.delete(id);
      }
    }
    return best;
  }
}

/**
 * Picks the credential carrying the least load.
 *
 * In-flight count is the primary key rather than lifetime request count: the
 * goal is to spread concurrent pressure, and a credential added an hour late
 * would otherwise absorb every request until its lifetime total caught up.
 */
function leastUsed(candidates: PoolAccount[]): PoolAccount {
  return candidates.reduce((best, account) => {
    if (account.inFlight !== best.inFlight) {
      return account.inFlight < best.inFlight ? account : best;
    }
    if (account.totalRequests !== best.totalRequests) {
      return account.totalRequests < best.totalRequests ? account : best;
    }
    return best;
  });
}

/**
 * Always prefers the same credential until it becomes unavailable.
 *
 * Candidates are already filtered to the top priority tier, so this is a
 * stable pick by weight then id — the pool only moves off it when the current
 * favourite drops out of the candidate list entirely.
 */
function failoverCascade(candidates: PoolAccount[]): PoolAccount {
  return candidates.reduce((best, account) => {
    if (account.weight !== best.weight) {
      return account.weight > best.weight ? account : best;
    }
    return account.id < best.id ? account : best;
  });
}

/**
 * Gathers every eligible credential for a request, ordered for selection.
 *
 * Returns the reason nothing matched when the list comes back empty, because
 * the caller has to distinguish "wait, these come back at T" from "nothing in
 * this pool can ever serve this model".
 */
export function eligibleCandidates(
  pool: AccountPool,
  request: SelectionRequest,
): { candidates: PoolAccount[]; reason: NoCandidateReason | null } {
  const all = pool.all();
  if (all.length === 0) {
    return { candidates: [], reason: { kind: 'empty_pool', earliestRetryAt: null } };
  }

  const byPriority = new Map<number, PoolAccount[]>();
  let cooldownCount = 0;
  let saturatedCount = 0;
  let modelMatchCount = 0;
  let excludedCount = 0;
  let earliestRetryAt: number | null = null;

  for (const account of all) {
    if (account.protocol !== request.protocol) continue;
    if (!pool.servesModel(account, request.model)) continue;
    modelMatchCount += 1;

    if (request.exclude.has(account.id)) {
      excludedCount += 1;
      continue;
    }

    const availability = pool.availability(account, request.model, request.now);
    if (availability.blocked) {
      // A spent daily budget is grouped with cooldown: both are time-bounded
      // holds with a known recovery moment, and the caller's decision — tell
      // the client when to come back — is the same for either.
      if (availability.reason === 'cooldown' || availability.reason === 'budget') {
        cooldownCount += 1;
        if (
          availability.nextRetryAt !== null &&
          (earliestRetryAt === null || availability.nextRetryAt < earliestRetryAt)
        ) {
          earliestRetryAt = availability.nextRetryAt;
        }
      } else if (availability.reason === 'saturated') {
        saturatedCount += 1;
      }
      continue;
    }

    const bucket = byPriority.get(account.priority);
    if (bucket === undefined) byPriority.set(account.priority, [account]);
    else bucket.push(account);
  }

  if (modelMatchCount === 0) {
    return { candidates: [], reason: { kind: 'no_model_match', earliestRetryAt: null } };
  }
  if (byPriority.size === 0) {
    if (cooldownCount > 0) {
      return { candidates: [], reason: { kind: 'all_cooldown', earliestRetryAt } };
    }
    if (saturatedCount > 0) {
      return { candidates: [], reason: { kind: 'all_saturated', earliestRetryAt: null } };
    }
    if (excludedCount > 0) {
      return { candidates: [], reason: { kind: 'all_excluded', earliestRetryAt: null } };
    }
    return { candidates: [], reason: { kind: 'empty_pool', earliestRetryAt: null } };
  }

  const topPriority = Math.min(...byPriority.keys());
  const candidates = (byPriority.get(topPriority) ?? []).slice();
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { candidates, reason: null };
}
