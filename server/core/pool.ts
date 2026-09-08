/**
 * The account pool: in-memory credential state, persisted through SQLite.
 *
 * Health is derived, never stored as a field. A credential is ACTIVE unless a
 * live cooldown row says otherwise, so a restart cannot resurrect a stale
 * "healthy" flag and a cooldown that has simply expired needs no sweeper to
 * clear it.
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import { decryptSecret, encryptSecret, maskSecret } from './crypto.js';
import { computeCooldown, type BackoffPolicy, type CooldownWindow } from './backoff.js';
import { RouterError, summarizeUpstreamError } from './errors.js';
import { PROVIDERS, protocolOf } from '../providers/registry.js';
import type {
  AccountDto,
  CooldownRecordDto,
  CreateAccountInput,
  ErrorClass,
  HealthState,
  ProviderId,
  UpdateAccountInput,
  UpstreamProtocol,
} from '../../shared/types.js';

/** Cooldown state for one credential, or one credential/model pair. */
export interface CooldownRecord {
  model: string;
  health: Extract<HealthState, 'COOLDOWN' | 'TEMP_ERROR'>;
  reason: string;
  errorClass: ErrorClass;
  nextRetryAt: number;
  backoffLevel: number;
  updatedAt: number;
}

export interface PoolAccount {
  id: string;
  name: string;
  provider: ProviderId;
  protocol: UpstreamProtocol;
  baseUrl: string;
  /** Decrypted, held in memory only. Never serialised into a DTO. */
  apiKey: string;
  apiKeyMasked: string;
  models: string[];
  enabled: boolean;
  priority: number;
  weight: number;
  maxConcurrent: number;
  /** Soft daily token cap the operator set. 0 means no cap. */
  dailyTokenBudget: number;
  todayTokens: number;
  todayRequests: number;
  /** Start of the budget day these counters belong to. */
  budgetDayStart: number;
  inFlight: number;
  consecutiveFailures: number;
  totalRequests: number;
  totalSuccess: number;
  totalFailures: number;
  promptTokens: number;
  completionTokens: number;
  lastUsedAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  tags: string[];
  notes: string | null;
  createdAt: number;
  /** Keyed by model; the empty string key holds the credential-wide cooldown. */
  cooldowns: Map<string, CooldownRecord>;
}

export type BlockReason =
  | 'none'
  | 'disabled'
  | 'cooldown'
  | 'saturated'
  | 'model'
  | 'budget';

export interface Availability {
  blocked: boolean;
  reason: BlockReason;
  /** When the block lifts, if it is time-bounded. */
  nextRetryAt: number | null;
}

interface AccountRow {
  id: string;
  name: string;
  provider: string;
  protocol: string;
  base_url: string;
  api_key_cipher: string;
  api_key_masked: string;
  models: string;
  enabled: number;
  priority: number;
  weight: number;
  max_concurrent: number;
  daily_token_budget: number;
  today_tokens: number;
  today_requests: number;
  budget_day_start: number;
  consecutive_failures: number;
  total_requests: number;
  total_success: number;
  total_failures: number;
  prompt_tokens: number;
  completion_tokens: number;
  last_used_at: number | null;
  last_error_at: number | null;
  last_error: string | null;
  tags: string;
  notes: string | null;
  created_at: number;
}

interface CooldownRow {
  account_id: string;
  model: string;
  health: string;
  reason: string;
  error_class: string;
  next_retry_at: number;
  backoff_level: number;
  updated_at: number;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Normalises a model id for comparison.
 *
 * Clients address the same model through several spellings — `models/x` from
 * Gemini clients, a `provider/x` prefix from OpenAI-compatible gateways, and a
 * `:latest`-style suffix from some tools. Matching on the bare name keeps a
 * credential eligible regardless of which spelling arrived.
 */
export function canonicalModel(model: string): string {
  let value = model.trim().toLowerCase();
  if (value.startsWith('models/')) value = value.slice('models/'.length);
  const slash = value.lastIndexOf('/');
  if (slash !== -1) value = value.slice(slash + 1);
  return value;
}

/**
 * Start of the UTC day containing `at`.
 *
 * Budgets reset on the UTC boundary rather than a local one so the window lines
 * up with how providers publish their own daily quotas.
 */
export function budgetDayStart(at: number): number {
  return Date.UTC(
    new Date(at).getUTCFullYear(),
    new Date(at).getUTCMonth(),
    new Date(at).getUTCDate(),
  );
}

/**
 * Monotonic within a process, so two accounts created in the same millisecond
 * still sort in the order they were added.
 */
let accountSequence = 0;

export class AccountPool extends EventEmitter {
  private readonly accounts = new Map<string, PoolAccount>();

  constructor(
    private readonly db: Db,
    private readonly encryptionKey: Buffer,
  ) {
    super();
    this.load();
  }

  // -------------------------------------------------------------------------
  // Loading & persistence
  // -------------------------------------------------------------------------

  private load(): void {
    const rows = this.db.prepare('SELECT * FROM accounts ORDER BY created_at ASC').all() as AccountRow[];
    const cooldownRows = this.db.prepare('SELECT * FROM cooldowns').all() as CooldownRow[];

    this.accounts.clear();
    for (const row of rows) {
      let apiKey = '';
      try {
        apiKey = decryptSecret(row.api_key_cipher, this.encryptionKey);
      } catch {
        // A key encrypted under a different ROUTER_SECRET cannot be recovered.
        // The account is kept visible but disabled so the operator can see it
        // needs re-entry, rather than silently vanishing from the dashboard.
        apiKey = '';
      }
      this.accounts.set(row.id, {
        id: row.id,
        name: row.name,
        provider: row.provider as ProviderId,
        protocol: row.protocol as UpstreamProtocol,
        baseUrl: row.base_url,
        apiKey,
        apiKeyMasked: row.api_key_masked,
        models: parseJsonArray(row.models),
        enabled: row.enabled === 1 && apiKey !== '',
        priority: row.priority,
        weight: row.weight,
        maxConcurrent: row.max_concurrent,
        dailyTokenBudget: row.daily_token_budget,
        todayTokens: row.today_tokens,
        todayRequests: row.today_requests,
        budgetDayStart: row.budget_day_start,
        inFlight: 0,
        consecutiveFailures: row.consecutive_failures,
        totalRequests: row.total_requests,
        totalSuccess: row.total_success,
        totalFailures: row.total_failures,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        lastUsedAt: row.last_used_at,
        lastErrorAt: row.last_error_at,
        lastError: apiKey === '' ? 'stored credential could not be decrypted' : row.last_error,
        tags: parseJsonArray(row.tags),
        notes: row.notes,
        createdAt: row.created_at,
        cooldowns: new Map(),
      });
    }

    for (const row of cooldownRows) {
      const account = this.accounts.get(row.account_id);
      if (account === undefined) continue;
      account.cooldowns.set(row.model, {
        model: row.model,
        health: row.health === 'TEMP_ERROR' ? 'TEMP_ERROR' : 'COOLDOWN',
        reason: row.reason,
        errorClass: row.error_class as ErrorClass,
        nextRetryAt: row.next_retry_at,
        backoffLevel: row.backoff_level,
        updatedAt: row.updated_at,
      });
    }
  }

  private persistCooldown(accountId: string, record: CooldownRecord): void {
    this.db
      .prepare(
        `INSERT INTO cooldowns
           (account_id, model, health, reason, error_class, next_retry_at, backoff_level, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, model) DO UPDATE SET
           health = excluded.health,
           reason = excluded.reason,
           error_class = excluded.error_class,
           next_retry_at = excluded.next_retry_at,
           backoff_level = excluded.backoff_level,
           updated_at = excluded.updated_at`,
      )
      .run(
        accountId,
        record.model,
        record.health,
        record.reason,
        record.errorClass,
        record.nextRetryAt,
        record.backoffLevel,
        record.updatedAt,
      );
  }

  private deleteCooldown(accountId: string, model: string): void {
    this.db
      .prepare('DELETE FROM cooldowns WHERE account_id = ? AND model = ?')
      .run(accountId, model);
  }

  private persistCounters(account: PoolAccount): void {
    this.db
      .prepare(
        `UPDATE accounts SET
           consecutive_failures = ?, total_requests = ?, total_success = ?,
           total_failures = ?, prompt_tokens = ?, completion_tokens = ?,
           today_tokens = ?, today_requests = ?, budget_day_start = ?,
           last_used_at = ?, last_error_at = ?, last_error = ?, enabled = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        account.consecutiveFailures,
        account.totalRequests,
        account.totalSuccess,
        account.totalFailures,
        account.promptTokens,
        account.completionTokens,
        account.todayTokens,
        account.todayRequests,
        account.budgetDayStart,
        account.lastUsedAt,
        account.lastErrorAt,
        account.lastError,
        account.enabled ? 1 : 0,
        Date.now(),
        account.id,
      );
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  get(id: string): PoolAccount | undefined {
    return this.accounts.get(id);
  }

  all(): PoolAccount[] {
    return [...this.accounts.values()];
  }

  /** Total in-flight upstream requests across the pool. */
  totalInFlight(): number {
    let total = 0;
    for (const account of this.accounts.values()) total += account.inFlight;
    return total;
  }

  /**
   * Whether a credential can serve `model`.
   *
   * An account with no declared models accepts anything, which is what makes an
   * unconfigured OpenAI-compatible endpoint usable without enumerating its
   * catalogue first.
   */
  servesModel(account: PoolAccount, model: string): boolean {
    if (account.models.length === 0) return true;
    const wanted = canonicalModel(model);
    return account.models.some((candidate) => canonicalModel(candidate) === wanted);
  }

  /**
   * Live cooldown for a credential/model pair, if any.
   *
   * The credential-wide row is checked first and wins, because a credential
   * that is entirely rate limited cannot serve a model that happens to have no
   * row of its own.
   */
  activeCooldown(account: PoolAccount, model: string, now: number): CooldownRecord | null {
    const wide = account.cooldowns.get('');
    if (wide !== undefined && wide.nextRetryAt > now) return wide;

    const key = canonicalModel(model);
    for (const record of account.cooldowns.values()) {
      if (record.model === '') continue;
      if (canonicalModel(record.model) !== key) continue;
      if (record.nextRetryAt > now) return record;
    }
    return null;
  }

  /**
   * Rolls the daily counters over when the UTC day has changed.
   *
   * Done lazily on read rather than on a timer: a router that was asleep at
   * midnight would otherwise carry yesterday's total into today and hold a
   * credential out of rotation over a budget it never actually spent.
   */
  private rollBudgetDay(account: PoolAccount, now: number): void {
    const today = budgetDayStart(now);
    if (account.budgetDayStart === today) return;
    account.budgetDayStart = today;
    account.todayTokens = 0;
    account.todayRequests = 0;
  }

  /** Whether the operator's declared daily token budget is spent. */
  budgetExhausted(account: PoolAccount, now = Date.now()): boolean {
    if (account.dailyTokenBudget <= 0) return false;
    this.rollBudgetDay(account, now);
    return account.todayTokens >= account.dailyTokenBudget;
  }

  /**
   * Derived health for the credential as a whole.
   *
   * Per-model cooldowns are aggregated rather than ignored: a credential that
   * declares one model and is rate limited on it is not usable, and reporting
   * ACTIVE there would tell the operator the pool is healthier than it is. A
   * credential that declares several models stays ACTIVE until every one of
   * them is held, and one that declares none is never judged by model state
   * because it accepts models we have no record of.
   */
  healthOf(account: PoolAccount, now = Date.now()): HealthState {
    if (!account.enabled) return 'DISABLED';
    const wide = account.cooldowns.get('');
    if (wide !== undefined && wide.nextRetryAt > now) return wide.health;
    // A spent budget is a cooldown the operator imposed rather than the
    // upstream, but it blocks selection the same way and recovers on a known
    // schedule, so it is reported as one.
    if (this.budgetExhausted(account, now)) return 'COOLDOWN';

    if (account.models.length > 0) {
      const held = account.models.filter(
        (model) => this.activeCooldown(account, model, now) !== null,
      );
      if (held.length === account.models.length) {
        // Report the state of whichever hold lasts longest, so the dashboard
        // shows the reason the credential actually comes back on.
        const worst = held
          .map((model) => this.activeCooldown(account, model, now))
          .filter((record): record is CooldownRecord => record !== null)
          .sort((a, b) => b.nextRetryAt - a.nextRetryAt)[0];
        return worst?.health ?? 'COOLDOWN';
      }
    }
    return 'ACTIVE';
  }

  /** The longest-running hold on this credential, for display. */
  dominantCooldown(account: PoolAccount, now = Date.now()): CooldownRecord | null {
    const records = [...account.cooldowns.values()].filter(
      (record) => record.nextRetryAt > now,
    );
    if (records.length === 0) return null;
    return records.sort((a, b) => b.nextRetryAt - a.nextRetryAt)[0];
  }

  /**
   * Whether a credential may be picked for `model` right now.
   *
   * `saturated` is deliberately distinct from `cooldown`: a credential at its
   * concurrency limit is healthy and will free up on its own, so the selector
   * skips it without the cooldown controller ever hearing about it.
   */
  availability(account: PoolAccount, model: string, now = Date.now()): Availability {
    if (!account.enabled) {
      return { blocked: true, reason: 'disabled', nextRetryAt: null };
    }
    if (!this.servesModel(account, model)) {
      return { blocked: true, reason: 'model', nextRetryAt: null };
    }
    const cooldown = this.activeCooldown(account, model, now);
    if (cooldown !== null) {
      return { blocked: true, reason: 'cooldown', nextRetryAt: cooldown.nextRetryAt };
    }
    if (this.budgetExhausted(account, now)) {
      return {
        blocked: true,
        reason: 'budget',
        nextRetryAt: budgetDayStart(now) + 24 * 60 * 60 * 1000,
      };
    }
    if (account.inFlight >= account.maxConcurrent) {
      return { blocked: true, reason: 'saturated', nextRetryAt: null };
    }
    return { blocked: false, reason: 'none', nextRetryAt: null };
  }

  // -------------------------------------------------------------------------
  // Concurrency accounting
  // -------------------------------------------------------------------------

  acquire(account: PoolAccount): void {
    account.inFlight += 1;
    account.lastUsedAt = Date.now();
    this.emit('changed');
  }

  release(account: PoolAccount): void {
    account.inFlight = Math.max(0, account.inFlight - 1);
    this.emit('changed');
  }

  // -------------------------------------------------------------------------
  // Outcome recording
  // -------------------------------------------------------------------------

  recordSuccess(
    account: PoolAccount,
    usage: { promptTokens?: number; completionTokens?: number } = {},
  ): void {
    account.totalRequests += 1;
    account.totalSuccess += 1;
    account.consecutiveFailures = 0;
    account.promptTokens += usage.promptTokens ?? 0;
    account.completionTokens += usage.completionTokens ?? 0;
    const now = Date.now();
    this.rollBudgetDay(account, now);
    account.todayTokens += (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
    account.todayRequests += 1;
    account.lastUsedAt = now;

    // A success proves the credential works, so any cooldown we imposed on our
    // own inference is stale. An upstream-declared window is left alone: the
    // upstream may still be counting it even though this call got through.
    const wide = account.cooldowns.get('');
    if (wide !== undefined && wide.health === 'TEMP_ERROR') {
      account.cooldowns.delete('');
      this.deleteCooldown(account.id, '');
    }

    this.persistCounters(account);
    this.emit('changed');
  }

  /**
   * Records a failure and applies the resulting cooldown.
   *
   * Request-scoped and client-scoped failures deliberately do not touch the
   * credential at all: a malformed request or a hung-up client says nothing
   * about the account's health, and penalizing it there would drain a healthy
   * pool over a client-side bug.
   */
  recordFailure(input: {
    account: PoolAccount;
    model: string;
    error: RouterError;
    policy: BackoffPolicy;
    disableAfterAuthFailures: number;
    now?: number;
    random?: () => number;
  }): CooldownRecord | null {
    const { account, error, policy } = input;
    const now = input.now ?? Date.now();

    account.totalRequests += 1;
    this.rollBudgetDay(account, now);
    account.todayRequests += 1;

    if (error.scope !== 'credential') {
      this.persistCounters(account);
      this.emit('changed');
      return null;
    }

    account.totalFailures += 1;
    account.consecutiveFailures += 1;
    account.lastErrorAt = now;
    account.lastError = summarizeUpstreamError(error.upstreamBody) ?? error.message;

    // A credential the upstream keeps rejecting is not going to heal on a
    // timer. Disabling it stops the pool from burning a retry slot on it every
    // single request until someone looks at the dashboard.
    if (
      error.errorClass === 'auth' &&
      account.consecutiveFailures >= input.disableAfterAuthFailures
    ) {
      account.enabled = false;
      this.db.prepare('UPDATE accounts SET enabled = 0, updated_at = ? WHERE id = ?').run(now, account.id);
      account.cooldowns.delete('');
      this.deleteCooldown(account.id, '');
      this.persistCounters(account);
      this.emit('changed');
      return null;
    }

    // Rate and quota limits are scoped to the model that hit them; everything
    // else is treated as a property of the credential itself.
    const scopeKey =
      error.errorClass === 'rate_limit' || error.errorClass === 'quota_exhausted'
        ? input.model
        : '';

    const previous = account.cooldowns.get(scopeKey) ?? null;
    const window: CooldownWindow = computeCooldown({
      errorClass: error.errorClass,
      previous:
        previous === null
          ? null
          : { nextRetryAt: previous.nextRetryAt, backoffLevel: previous.backoffLevel },
      retryAfterMs: error.retryAfterMs,
      policy,
      now,
      random: input.random,
    });

    const record: CooldownRecord = {
      model: scopeKey,
      health:
        error.errorClass === 'rate_limit' || error.errorClass === 'quota_exhausted'
          ? 'COOLDOWN'
          : 'TEMP_ERROR',
      reason: summarizeUpstreamError(error.upstreamBody) ?? error.message,
      errorClass: error.errorClass,
      nextRetryAt: window.nextRetryAt,
      backoffLevel: window.backoffLevel,
      updatedAt: now,
    };

    account.cooldowns.set(scopeKey, record);
    this.persistCooldown(account.id, record);
    this.persistCounters(account);
    this.emit('changed');
    return record;
  }

  // -------------------------------------------------------------------------
  // Manual controls (dashboard)
  // -------------------------------------------------------------------------

  /** Puts a credential into cooldown by hand, e.g. to drain it before a change. */
  forceCooldown(accountId: string, durationMs: number, reason: string): boolean {
    const account = this.accounts.get(accountId);
    if (account === undefined) return false;
    const now = Date.now();
    const record: CooldownRecord = {
      model: '',
      health: 'COOLDOWN',
      reason,
      errorClass: 'unknown',
      nextRetryAt: now + Math.max(durationMs, 0),
      backoffLevel: account.cooldowns.get('')?.backoffLevel ?? 0,
      updatedAt: now,
    };
    account.cooldowns.set('', record);
    this.persistCooldown(accountId, record);
    this.emit('changed');
    return true;
  }

  /** Clears every cooldown on a credential, including per-model ones. */
  clearCooldown(accountId: string): boolean {
    const account = this.accounts.get(accountId);
    if (account === undefined) return false;
    account.cooldowns.clear();
    account.consecutiveFailures = 0;
    this.db.prepare('DELETE FROM cooldowns WHERE account_id = ?').run(accountId);
    this.persistCounters(account);
    this.emit('changed');
    return true;
  }

  clearAllCooldowns(): number {
    let cleared = 0;
    for (const account of this.accounts.values()) {
      if (account.cooldowns.size === 0) continue;
      account.cooldowns.clear();
      account.consecutiveFailures = 0;
      cleared += 1;
    }
    this.db.prepare('DELETE FROM cooldowns').run();
    for (const account of this.accounts.values()) this.persistCounters(account);
    this.emit('changed');
    return cleared;
  }

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------

  create(input: CreateAccountInput): PoolAccount {
    const descriptor = PROVIDERS[input.provider];
    const baseUrl = (input.baseUrl ?? descriptor.defaultBaseUrl).trim();
    if (baseUrl === '') {
      throw new Error('baseUrl is required for this provider');
    }
    const apiKey = input.apiKey.trim();
    if (apiKey === '') {
      throw new Error('apiKey is required');
    }

    const now = Date.now();
    const account: PoolAccount = {
      // Ids sort in creation order because the round-robin ring resumes by
      // sorted id: a random id would make the rotation order arbitrary and
      // make which credential serves a given request unreproducible.
      id: `acc-${now.toString(36)}${(accountSequence++).toString(36).padStart(3, '0')}-${crypto.randomBytes(4).toString('hex')}`,
      name: input.name.trim() === '' ? `${descriptor.label} account` : input.name.trim(),
      provider: input.provider,
      protocol: protocolOf(input.provider),
      baseUrl,
      apiKey,
      apiKeyMasked: maskSecret(apiKey),
      models: input.models ?? [],
      enabled: true,
      priority: input.priority ?? 1,
      weight: input.weight ?? 50,
      maxConcurrent: input.maxConcurrent ?? 4,
      dailyTokenBudget: input.dailyTokenBudget ?? 0,
      todayTokens: 0,
      todayRequests: 0,
      budgetDayStart: budgetDayStart(now),
      inFlight: 0,
      consecutiveFailures: 0,
      totalRequests: 0,
      totalSuccess: 0,
      totalFailures: 0,
      promptTokens: 0,
      completionTokens: 0,
      lastUsedAt: null,
      lastErrorAt: null,
      lastError: null,
      tags: input.tags ?? [],
      notes: input.notes ?? null,
      createdAt: now,
      cooldowns: new Map(),
    };

    this.db
      .prepare(
        `INSERT INTO accounts
           (id, name, provider, protocol, base_url, api_key_cipher, api_key_masked,
            models, enabled, priority, weight, max_concurrent, daily_token_budget,
            budget_day_start, tags, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        account.id,
        account.name,
        account.provider,
        account.protocol,
        account.baseUrl,
        encryptSecret(apiKey, this.encryptionKey),
        account.apiKeyMasked,
        JSON.stringify(account.models),
        account.priority,
        account.weight,
        account.maxConcurrent,
        account.dailyTokenBudget,
        account.budgetDayStart,
        JSON.stringify(account.tags),
        account.notes,
        now,
        now,
      );

    this.accounts.set(account.id, account);
    this.emit('changed');
    return account;
  }

  update(id: string, input: UpdateAccountInput): PoolAccount | null {
    const account = this.accounts.get(id);
    if (account === undefined) return null;

    if (input.name !== undefined && input.name.trim() !== '') account.name = input.name.trim();
    if (input.baseUrl !== undefined && input.baseUrl.trim() !== '') account.baseUrl = input.baseUrl.trim();
    if (input.models !== undefined) account.models = input.models;
    if (input.priority !== undefined) account.priority = input.priority;
    if (input.weight !== undefined) account.weight = input.weight;
    if (input.maxConcurrent !== undefined) account.maxConcurrent = Math.max(1, input.maxConcurrent);
    if (input.dailyTokenBudget !== undefined) {
      account.dailyTokenBudget = Math.max(0, input.dailyTokenBudget);
    }
    if (input.tags !== undefined) account.tags = input.tags;
    if (input.notes !== undefined) account.notes = input.notes;
    if (input.enabled !== undefined) {
      account.enabled = input.enabled;
      // Re-enabling is an explicit statement that the operator believes the
      // credential is usable again, so the failure streak that disabled it is
      // cleared rather than left to trip on the next request.
      if (input.enabled) account.consecutiveFailures = 0;
    }

    let cipher: string | null = null;
    if (input.apiKey !== undefined && input.apiKey.trim() !== '') {
      account.apiKey = input.apiKey.trim();
      account.apiKeyMasked = maskSecret(account.apiKey);
      cipher = encryptSecret(account.apiKey, this.encryptionKey);
    }

    this.db
      .prepare(
        `UPDATE accounts SET
           name = ?, base_url = ?, models = ?, enabled = ?, priority = ?,
           weight = ?, max_concurrent = ?, daily_token_budget = ?, tags = ?, notes = ?,
           api_key_cipher = COALESCE(?, api_key_cipher),
           api_key_masked = ?, consecutive_failures = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        account.name,
        account.baseUrl,
        JSON.stringify(account.models),
        account.enabled ? 1 : 0,
        account.priority,
        account.weight,
        account.maxConcurrent,
        account.dailyTokenBudget,
        JSON.stringify(account.tags),
        account.notes,
        cipher,
        account.apiKeyMasked,
        account.consecutiveFailures,
        Date.now(),
        id,
      );

    this.emit('changed');
    return account;
  }

  remove(id: string): boolean {
    if (!this.accounts.has(id)) return false;
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    this.accounts.delete(id);
    this.emit('changed');
    return true;
  }

  // -------------------------------------------------------------------------
  // Serialisation
  // -------------------------------------------------------------------------

  toDto(account: PoolAccount, now = Date.now()): AccountDto {
    const cooldowns: CooldownRecordDto[] = [...account.cooldowns.values()]
      .filter((record) => record.nextRetryAt > now)
      .map((record) => ({
        model: record.model,
        reason: record.reason,
        errorClass: record.errorClass,
        nextRetryAt: record.nextRetryAt,
        backoffLevel: record.backoffLevel,
        updatedAt: record.updatedAt,
      }));

    const health = this.healthOf(account, now);
    // When health is driven by per-model holds, the countdown shown must be the
    // one that actually gates the credential.
    const wide = account.cooldowns.get('');
    const wideActive =
      wide !== undefined && wide.nextRetryAt > now
        ? wide
        : health === 'COOLDOWN' || health === 'TEMP_ERROR'
          ? this.dominantCooldown(account, now)
          : null;

    return {
      id: account.id,
      name: account.name,
      provider: account.provider,
      protocol: account.protocol,
      baseUrl: account.baseUrl,
      apiKeyMasked: account.apiKeyMasked,
      models: account.models,
      enabled: account.enabled,
      health,
      nextRetryAt: wideActive?.nextRetryAt ?? null,
      cooldownReason: wideActive?.reason ?? null,
      backoffLevel: wideActive?.backoffLevel ?? 0,
      cooldowns,
      priority: account.priority,
      weight: account.weight,
      maxConcurrent: account.maxConcurrent,
      dailyTokenBudget: account.dailyTokenBudget,
      todayTokens: account.todayTokens,
      todayRequests: account.todayRequests,
      budgetDayStart: account.budgetDayStart,
      inFlight: account.inFlight,
      consecutiveFailures: account.consecutiveFailures,
      totalRequests: account.totalRequests,
      totalSuccess: account.totalSuccess,
      totalFailures: account.totalFailures,
      promptTokens: account.promptTokens,
      completionTokens: account.completionTokens,
      lastUsedAt: account.lastUsedAt,
      lastErrorAt: account.lastErrorAt,
      lastError: account.lastError,
      tags: account.tags,
      notes: account.notes,
      createdAt: account.createdAt,
    };
  }

  snapshot(now = Date.now()): AccountDto[] {
    return this.all().map((account) => this.toDto(account, now));
  }
}
