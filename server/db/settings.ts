/**
 * Runtime-tunable router settings.
 *
 * Stored as one JSON blob rather than a column per field: these are read on
 * every request and changed rarely, so a single row keeps reads cheap and lets
 * a new tunable ship without a migration.
 */

import type { Db } from './index.js';
import type { RouterSettingsDto, SelectionStrategy } from '../../shared/types.js';

const SETTINGS_KEY = 'router_settings';

export const DEFAULT_SETTINGS: RouterSettingsDto = {
  strategy: 'round_robin',
  maxRetryCredentials: 3,
  requestRetryRounds: 1,
  maxRetryIntervalMs: 5_000,
  cooldownBaseMs: 1_000,
  cooldownMaxMs: 30 * 60_000,
  transientCooldownMs: 60_000,
  disableAfterAuthFailures: 3,
  maxGlobalConcurrency: 32,
  upstreamTimeoutMs: 120_000,
  logRetentionDays: 7,
};

const STRATEGIES: SelectionStrategy[] = [
  'round_robin',
  'least_used',
  'weighted_priority',
  'failover_cascade',
];

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

/**
 * Coerces stored or submitted settings into a valid shape.
 *
 * Every field is clamped rather than rejected, so a bad value in one field
 * cannot leave the router without settings at all.
 */
export function normalizeSettings(input: unknown): RouterSettingsDto {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const strategy = STRATEGIES.includes(raw.strategy as SelectionStrategy)
    ? (raw.strategy as SelectionStrategy)
    : DEFAULT_SETTINGS.strategy;

  return {
    strategy,
    maxRetryCredentials: clampInt(raw.maxRetryCredentials, DEFAULT_SETTINGS.maxRetryCredentials, 1, 20),
    requestRetryRounds: clampInt(raw.requestRetryRounds, DEFAULT_SETTINGS.requestRetryRounds, 0, 5),
    maxRetryIntervalMs: clampInt(raw.maxRetryIntervalMs, DEFAULT_SETTINGS.maxRetryIntervalMs, 0, 60_000),
    cooldownBaseMs: clampInt(raw.cooldownBaseMs, DEFAULT_SETTINGS.cooldownBaseMs, 100, 60_000),
    cooldownMaxMs: clampInt(raw.cooldownMaxMs, DEFAULT_SETTINGS.cooldownMaxMs, 1_000, 24 * 60 * 60_000),
    transientCooldownMs: clampInt(raw.transientCooldownMs, DEFAULT_SETTINGS.transientCooldownMs, 1_000, 60 * 60_000),
    disableAfterAuthFailures: clampInt(raw.disableAfterAuthFailures, DEFAULT_SETTINGS.disableAfterAuthFailures, 1, 50),
    maxGlobalConcurrency: clampInt(raw.maxGlobalConcurrency, DEFAULT_SETTINGS.maxGlobalConcurrency, 1, 512),
    upstreamTimeoutMs: clampInt(raw.upstreamTimeoutMs, DEFAULT_SETTINGS.upstreamTimeoutMs, 1_000, 30 * 60_000),
    logRetentionDays: clampInt(raw.logRetentionDays, DEFAULT_SETTINGS.logRetentionDays, 1, 365),
  };
}

export class SettingsStore {
  private cached: RouterSettingsDto;

  constructor(private readonly db: Db) {
    this.cached = this.read();
  }

  private read(): RouterSettingsDto {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (row === undefined) return { ...DEFAULT_SETTINGS };
    try {
      return normalizeSettings(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): RouterSettingsDto {
    return this.cached;
  }

  update(patch: Partial<RouterSettingsDto>): RouterSettingsDto {
    const next = normalizeSettings({ ...this.cached, ...patch });
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTINGS_KEY, JSON.stringify(next));
    this.cached = next;
    return next;
  }
}
