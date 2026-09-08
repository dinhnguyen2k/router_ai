export type AccountStatus = 
  | 'active'          // Sẵn sàng nhận request
  | 'in_use'          // Đang xử lý stream / request
  | 'cooldown'        // Đang chờ hồi (Rate limited / cooloff)
  | 'quota_exceeded'  // Hết hạn mức ngày/tháng
  | 'idle'            // Chờ phân bổ
  | 'suspended';      // Lỗi token / vô hiệu hóa

export type ProviderType = 
  | 'OpenAI' 
  | 'Anthropic' 
  | 'Google Gemini' 
  | 'DeepSeek' 
  | 'Groq' 
  | 'Mistral AI';

export type RotationStrategy = 
  | 'round_robin'      // Xoay vòng tuần tự
  | 'least_used'       // Ưu tiên tài khoản dùng ít nhất
  | 'weighted_priority'// Theo trọng số ưu tiên
  | 'failover_cascade';// Ưu tiên chính, lỗi mới nhảy

export interface QuotaData {
  usedTokens: number;
  totalTokens: number;
  rpmCurrent: number;
  rpmLimit: number;
  tpmCurrent: number;
  tpmLimit: number;
  dailySpentUsd: number;
  dailyBudgetUsd: number;
  resetTime: string; // ví dụ: "00:00 UTC (trong 5 giờ)"
}

export interface CooldownData {
  isInCooldown: boolean;
  remainingSeconds: number;
  totalDurationSeconds: number;
  reason: string;
  triggerTimestamp: string;
}

export interface AIAccount {
  id: string;
  name: string;
  provider: ProviderType;
  modelTier: string;
  apiKeyMasked: string;
  status: AccountStatus;
  priority: number; // 1 (Cao nhất) -> 5
  weight: number;   // 1 -> 100
  quota: QuotaData;
  cooldown: CooldownData;
  successRate: number; // %
  lastUsedAt: string;
  totalRequestsToday: number;
  tags: string[];
  notes?: string;
}

export interface PoolStats {
  totalAccounts: number;
  activeAccounts: number;
  inUseAccounts: number;
  cooldownAccounts: number;
  quotaExceededAccounts: number;
  totalTokensUsedToday: number;
  totalTokenLimitToday: number;
  poolAvailabilityPercent: number;
  avgLatencyMs: number;
  activeStrategy: RotationStrategy;
  currentActiveAccountId: string;
}

export interface QuotaTimelinePoint {
  time: string;
  tokensUsed: number;
  limitCap: number;
  requestsCount: number;
}

export interface ProviderQuotaShare {
  name: ProviderType;
  usedTokens: number;
  allocatedTokens: number;
  accountCount: number;
  color: string;
}
