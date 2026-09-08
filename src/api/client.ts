/**
 * Management API client.
 *
 * The only place in the dashboard that knows about HTTP. Components and hooks
 * work with DTOs and never see a URL, so a route change touches this file
 * alone.
 */

import type {
  AccountDto,
  CreateAccountInput,
  MetricsSummaryDto,
  PoolStatusDto,
  ProviderDescriptor,
  ProviderUsageDto,
  RequestLogDto,
  RouterSettingsDto,
  TimelinePointDto,
  UpdateAccountInput,
} from '../../shared/types';

/**
 * Vite proxies /api to the router during development, and in production the
 * router serves the built dashboard from its own origin, so a relative base
 * works in both cases.
 */
const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers:
        init.body === undefined
          ? init.headers
          : { 'content-type': 'application/json', ...init.headers },
    });
  } catch (err) {
    // A network failure here means the router process is not running, which is
    // a different problem from an API error and deserves its own message.
    throw new ApiError(
      0,
      'router_unreachable',
      'Không kết nối được tới Router. Kiểm tra tiến trình router đã chạy chưa.',
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload = text === '' ? null : (JSON.parse(text) as unknown);

  if (!response.ok) {
    const detail =
      payload !== null && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    throw new ApiError(
      response.status,
      detail?.code ?? 'unknown',
      detail?.message ?? `Yêu cầu thất bại (${response.status})`,
    );
  }

  return payload as T;
}

export interface ConnectionInfo {
  baseUrl: string;
  token: string;
  openaiBaseUrl: string;
  geminiBaseUrl: string;
}

export const api = {
  status: () => request<PoolStatusDto>('/status'),
  providers: () => request<ProviderDescriptor[]>('/providers'),
  connection: () => request<ConnectionInfo>('/connection'),

  accounts: () => request<AccountDto[]>('/accounts'),
  account: (id: string) => request<AccountDto>(`/accounts/${id}`),
  createAccount: (input: CreateAccountInput) =>
    request<AccountDto>('/accounts', { method: 'POST', body: JSON.stringify(input) }),
  updateAccount: (id: string, input: UpdateAccountInput) =>
    request<AccountDto>(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteAccount: (id: string) => request<void>(`/accounts/${id}`, { method: 'DELETE' }),

  forceCooldown: (id: string, durationMs: number, reason?: string) =>
    request<AccountDto>(`/accounts/${id}/cooldown`, {
      method: 'POST',
      body: JSON.stringify({ durationMs, reason }),
    }),
  clearCooldown: (id: string) =>
    request<AccountDto>(`/accounts/${id}/clear-cooldown`, { method: 'POST' }),
  clearAllCooldowns: () =>
    request<{ cleared: number }>('/cooldowns/clear', { method: 'POST' }),

  settings: () => request<RouterSettingsDto>('/settings'),
  updateSettings: (patch: Partial<RouterSettingsDto>) =>
    request<RouterSettingsDto>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  logs: (params: { limit?: number; outcome?: string; accountId?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.outcome !== undefined && params.outcome !== 'all') {
      query.set('outcome', params.outcome);
    }
    if (params.accountId !== undefined) query.set('accountId', params.accountId);
    const suffix = query.toString() === '' ? '' : `?${query.toString()}`;
    return request<RequestLogDto[]>(`/logs${suffix}`);
  },

  metrics: (windowMs?: number) =>
    request<MetricsSummaryDto>(`/metrics${windowMs === undefined ? '' : `?window=${windowMs}`}`),
  timeline: (windowMs: number, buckets: number) =>
    request<TimelinePointDto[]>(`/metrics/timeline?window=${windowMs}&buckets=${buckets}`),
  providerUsage: (windowMs?: number) =>
    request<ProviderUsageDto[]>(
      `/metrics/providers${windowMs === undefined ? '' : `?window=${windowMs}`}`,
    ),
};
