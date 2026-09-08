/**
 * Dashboard view models.
 *
 * Derived from the wire DTOs in shared/types.ts rather than mirroring them, so
 * components work with values already shaped for display (percentages,
 * countdowns, resolved labels) and never do arithmetic on raw counters.
 */

import type {
  AccountDto,
  CooldownRecordDto,
  ErrorClass,
  HealthState,
  ProviderId,
  RequestOutcome,
  SelectionStrategy,
  UpstreamProtocol,
} from '../shared/types';

export type {
  ErrorClass,
  HealthState,
  ProviderId,
  RequestOutcome,
  SelectionStrategy,
  UpstreamProtocol,
};

/**
 * The status a row in the table shows.
 *
 * Wider than HealthState because the table also distinguishes a credential that
 * is currently serving traffic from one that is merely healthy, which is a
 * display concern the router has no reason to track.
 */
export type AccountStatus =
  | 'active'
  | 'in_use'
  | 'cooldown'
  | 'temp_error'
  | 'quota_exceeded'
  | 'disabled';

export interface CooldownView {
  isInCooldown: boolean;
  remainingSeconds: number;
  reason: string;
  /** Empty string when the cooldown covers the whole credential. */
  model: string;
  errorClass: ErrorClass;
  backoffLevel: number;
}

export interface QuotaView {
  /** Tokens spent in the current UTC day. */
  todayTokens: number;
  /** Operator-declared daily cap; 0 means uncapped. */
  dailyTokenBudget: number;
  /** Percentage of the budget spent, or null when uncapped. */
  usedPercent: number | null;
  todayRequests: number;
  promptTokens: number;
  completionTokens: number;
  /** When the daily counters roll over. */
  resetsAt: number;
}

export interface AIAccount {
  id: string;
  name: string;
  provider: ProviderId;
  providerLabel: string;
  protocol: UpstreamProtocol;
  baseUrl: string;
  apiKeyMasked: string;
  models: string[];
  /** Human-readable model summary for the table row. */
  modelSummary: string;
  status: AccountStatus;
  health: HealthState;
  enabled: boolean;
  priority: number;
  weight: number;
  maxConcurrent: number;
  inFlight: number;
  quota: QuotaView;
  cooldown: CooldownView;
  /** Per-model holds, for the detail modal. */
  cooldowns: CooldownRecordDto[];
  successRate: number;
  totalRequests: number;
  totalSuccess: number;
  totalFailures: number;
  consecutiveFailures: number;
  lastUsedAt: number | null;
  lastError: string | null;
  tags: string[];
  notes: string | null;
}

const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  mistral: 'Mistral AI',
  openai_compatible: 'OpenAI-compatible',
};

/**
 * Maps health plus live load onto the status a row shows.
 *
 * A budget-exhausted credential reports COOLDOWN from the router but is shown
 * as quota_exceeded, because the operator set that limit themselves and the
 * remedy is different from waiting out an upstream rate limit.
 */
function statusOf(dto: AccountDto, now: number): AccountStatus {
  if (!dto.enabled) return 'disabled';
  if (dto.health === 'DISABLED') return 'disabled';
  if (dto.health === 'TEMP_ERROR') return 'temp_error';
  if (dto.health === 'COOLDOWN') {
    const budgetSpent =
      dto.dailyTokenBudget > 0 && dto.todayTokens >= dto.dailyTokenBudget;
    // An upstream-declared window wins the label: it is the more urgent fact.
    if (dto.nextRetryAt !== null && dto.nextRetryAt > now) return 'cooldown';
    return budgetSpent ? 'quota_exceeded' : 'cooldown';
  }
  return dto.inFlight > 0 ? 'in_use' : 'active';
}

export function toAccountView(dto: AccountDto, now = Date.now()): AIAccount {
  const decided = dto.totalSuccess + dto.totalFailures;
  const remainingMs = dto.nextRetryAt === null ? 0 : dto.nextRetryAt - now;

  return {
    id: dto.id,
    name: dto.name,
    provider: dto.provider,
    providerLabel: PROVIDER_LABELS[dto.provider] ?? dto.provider,
    protocol: dto.protocol,
    baseUrl: dto.baseUrl,
    apiKeyMasked: dto.apiKeyMasked,
    models: dto.models,
    modelSummary:
      dto.models.length === 0
        ? 'Mọi model'
        : dto.models.length <= 2
          ? dto.models.join(', ')
          : `${dto.models[0]} +${dto.models.length - 1}`,
    status: statusOf(dto, now),
    health: dto.health,
    enabled: dto.enabled,
    priority: dto.priority,
    weight: dto.weight,
    maxConcurrent: dto.maxConcurrent,
    inFlight: dto.inFlight,
    quota: {
      todayTokens: dto.todayTokens,
      dailyTokenBudget: dto.dailyTokenBudget,
      usedPercent:
        dto.dailyTokenBudget > 0
          ? Math.min(100, Math.round((dto.todayTokens / dto.dailyTokenBudget) * 100))
          : null,
      todayRequests: dto.todayRequests,
      promptTokens: dto.promptTokens,
      completionTokens: dto.completionTokens,
      resetsAt: dto.budgetDayStart + 24 * 60 * 60 * 1000,
    },
    cooldown: {
      isInCooldown: remainingMs > 0,
      remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
      reason: dto.cooldownReason ?? '',
      model: '',
      errorClass: dto.cooldowns[0]?.errorClass ?? 'unknown',
      backoffLevel: dto.backoffLevel,
    },
    cooldowns: dto.cooldowns,
    successRate: decided === 0 ? 100 : Math.round((dto.totalSuccess / decided) * 1000) / 10,
    totalRequests: dto.totalRequests,
    totalSuccess: dto.totalSuccess,
    totalFailures: dto.totalFailures,
    consecutiveFailures: dto.consecutiveFailures,
    lastUsedAt: dto.lastUsedAt,
    lastError: dto.lastError,
    tags: dto.tags,
    notes: dto.notes,
  };
}

// --- Display helpers --------------------------------------------------------

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

export function formatRelativeTime(at: number | null): string {
  if (at === null) return 'Chưa dùng';
  const delta = Date.now() - at;
  if (delta < 5_000) return 'Vừa xong';
  if (delta < 60_000) return `${Math.floor(delta / 1000)} giây trước`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} phút trước`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} giờ trước`;
  return `${Math.floor(delta / 86_400_000)} ngày trước`;
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export const ERROR_CLASS_LABELS: Record<ErrorClass, string> = {
  rate_limit: 'Rate limit',
  quota_exhausted: 'Hết quota',
  auth: 'Lỗi xác thực',
  server: 'Lỗi upstream',
  timeout: 'Timeout',
  network: 'Lỗi mạng',
  request_fault: 'Lỗi request',
  cancelled: 'Đã hủy',
  unknown: 'Không rõ',
};

export const OUTCOME_LABELS: Record<RequestOutcome, string> = {
  success: 'Thành công',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
  partial_failure: 'Đứt giữa stream',
};

export const STRATEGY_LABELS: Record<SelectionStrategy, { title: string; desc: string }> = {
  round_robin: {
    title: 'Round Robin',
    desc: 'Luân phiên tuần tự từng tài khoản theo vòng lặp',
  },
  least_used: {
    title: 'Cân bằng tải (Least Used)',
    desc: 'Ưu tiên tài khoản đang gánh ít request nhất',
  },
  weighted_priority: {
    title: 'Trọng số ưu tiên (Weighted)',
    desc: 'Phân phối theo cấu hình Priority và Trọng số',
  },
  failover_cascade: {
    title: 'Dự phòng thác đổ (Failover)',
    desc: 'Bám tài khoản chính, chỉ nhảy khi nó không khả dụng',
  },
};
