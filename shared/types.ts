/**
 * Types shared between the Router Core (server) and the dashboard (src).
 *
 * The dashboard's view models live in src/types.ts and are derived from these
 * DTOs, so a change to the wire format never silently reshapes a component.
 */

// ---------------------------------------------------------------------------
// Protocol & provider
// ---------------------------------------------------------------------------

/**
 * The wire protocol a credential speaks. Failover is only ever attempted
 * between accounts that share a protocol, because the router forwards request
 * bodies unmodified and cannot guarantee semantics across protocols.
 */
export type UpstreamProtocol = 'openai' | 'gemini';

export type ProviderId =
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'groq'
  | 'mistral'
  | 'openai_compatible';

export interface ProviderDescriptor {
  id: ProviderId;
  /** Display label used by the dashboard. */
  label: string;
  protocol: UpstreamProtocol;
  /** Base URL used when an account does not override it. */
  defaultBaseUrl: string;
  /** Models advertised when an account declares none of its own. */
  suggestedModels: string[];
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Credential health as tracked by the Router Core.
 *
 * COOLDOWN and TEMP_ERROR are both time-bounded, but they are kept apart
 * because they come from different signals: COOLDOWN is a rate/quota limit the
 * upstream told us about, TEMP_ERROR is an inference we drew from a 5xx or a
 * transport failure. Merging them would make an upstream-declared reset time
 * indistinguishable from our own guess.
 */
export type HealthState = 'ACTIVE' | 'COOLDOWN' | 'TEMP_ERROR' | 'DISABLED';

/**
 * How an upstream failure was classified. Drives both cooldown policy and
 * whether the credential may be penalized at all.
 */
export type ErrorClass =
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth'
  | 'server'
  | 'timeout'
  | 'network'
  | 'request_fault'
  | 'cancelled'
  | 'unknown';

/**
 * Who owns the failure.
 *
 * - credential: the account is at fault; penalize it and try another.
 * - request: the request itself is malformed or too large; every account would
 *   fail identically, so return it to the caller untouched.
 * - client: the caller went away. Nothing to penalize, nothing to retry.
 */
export type ErrorScope = 'credential' | 'request' | 'client';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface CooldownRecordDto {
  /** Empty string means the cooldown applies to the whole credential. */
  model: string;
  reason: string;
  errorClass: ErrorClass;
  /** Epoch millis. */
  nextRetryAt: number;
  /** Exponential ladder position that produced nextRetryAt. */
  backoffLevel: number;
  updatedAt: number;
}

export interface AccountDto {
  id: string;
  name: string;
  provider: ProviderId;
  protocol: UpstreamProtocol;
  baseUrl: string;
  /** Never the key itself. */
  apiKeyMasked: string;
  models: string[];
  enabled: boolean;
  health: HealthState;
  /** Present while health is COOLDOWN or TEMP_ERROR. Epoch millis. */
  nextRetryAt: number | null;
  cooldownReason: string | null;
  backoffLevel: number;
  /** Per-model cooldowns; a credential can be limited on one model only. */
  cooldowns: CooldownRecordDto[];
  priority: number;
  weight: number;
  maxConcurrent: number;
  /** Soft daily token cap the operator set. 0 means no cap. */
  dailyTokenBudget: number;
  /** Tokens spent in the current budget day. */
  todayTokens: number;
  /** Requests served in the current budget day. */
  todayRequests: number;
  /** Start of the current budget day, epoch millis. */
  budgetDayStart: number;
  inFlight: number;
  /** Consecutive credential-scoped failures; resets on success. */
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
}

export interface CreateAccountInput {
  name: string;
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  priority?: number;
  weight?: number;
  maxConcurrent?: number;
  dailyTokenBudget?: number;
  tags?: string[];
  notes?: string;
}

export type UpdateAccountInput = Partial<Omit<CreateAccountInput, 'provider'>> & {
  enabled?: boolean;
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type SelectionStrategy =
  | 'round_robin'
  | 'least_used'
  | 'weighted_priority'
  | 'failover_cascade';

export interface RouterSettingsDto {
  strategy: SelectionStrategy;
  /** Distinct credentials tried per request before giving up. */
  maxRetryCredentials: number;
  /** Extra full rounds over the pool after the first pass. */
  requestRetryRounds: number;
  /** Upper bound on any single backoff wait, in ms. */
  maxRetryIntervalMs: number;
  /** Base of the exponential cooldown ladder, in ms. */
  cooldownBaseMs: number;
  /** Ceiling of the exponential cooldown ladder, in ms. */
  cooldownMaxMs: number;
  /** Cooldown applied to 5xx / transport failures, in ms. */
  transientCooldownMs: number;
  /** Consecutive auth failures before a credential is disabled outright. */
  disableAfterAuthFailures: number;
  /** Global cap on concurrent upstream requests. */
  maxGlobalConcurrency: number;
  /** Upstream connect + first-byte timeout, in ms. */
  upstreamTimeoutMs: number;
  /** How long a request log row is kept, in days. */
  logRetentionDays: number;
}

// ---------------------------------------------------------------------------
// Request log & metrics
// ---------------------------------------------------------------------------

/**
 * Terminal state of a routed request. `partial_failure` is the case the brief
 * singles out: bytes already reached the client when the upstream broke, so no
 * failover was possible and the stream was closed with an error event.
 */
export type RequestOutcome =
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'partial_failure';

export interface RequestAttemptDto {
  accountId: string | null;
  accountName: string | null;
  status: number | null;
  errorClass: ErrorClass | null;
  errorMessage: string | null;
  durationMs: number;
  /** True once bytes were forwarded downstream on this attempt. */
  committed: boolean;
}

export interface RequestLogDto {
  id: string;
  createdAt: number;
  protocol: UpstreamProtocol;
  model: string;
  stream: boolean;
  outcome: RequestOutcome;
  status: number | null;
  accountId: string | null;
  accountName: string | null;
  durationMs: number;
  /** Milliseconds until the first byte reached the client; null if none did. */
  ttfbMs: number | null;
  attemptCount: number;
  attempts: RequestAttemptDto[];
  promptTokens: number | null;
  completionTokens: number | null;
  errorClass: ErrorClass | null;
  errorMessage: string | null;
}

export interface PoolStatusDto {
  totalAccounts: number;
  activeAccounts: number;
  cooldownAccounts: number;
  tempErrorAccounts: number;
  disabledAccounts: number;
  inFlight: number;
  /** Account currently holding the most in-flight requests, if any. */
  servingAccountId: string | null;
  strategy: SelectionStrategy;
  endpoint: {
    baseUrl: string;
    openaiPath: string;
    geminiPath: string;
    /** Whether a local token is required on inbound requests. */
    authRequired: boolean;
  };
  uptimeMs: number;
}

export interface MetricsSummaryDto {
  windowMs: number;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  cancelledRequests: number;
  partialFailures: number;
  failoverCount: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgTtfbMs: number | null;
  promptTokens: number;
  completionTokens: number;
}

export interface TimelinePointDto {
  /** Bucket start, epoch millis. */
  t: number;
  requests: number;
  success: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ProviderUsageDto {
  provider: ProviderId;
  label: string;
  accountCount: number;
  requests: number;
  promptTokens: number;
  completionTokens: number;
}

export interface ApiError {
  error: { code: string; message: string };
}
