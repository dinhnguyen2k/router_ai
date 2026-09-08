import { AIAccount, ProviderQuotaShare, QuotaTimelinePoint } from './types';

export const INITIAL_ACCOUNTS: AIAccount[] = [
  {
    id: 'acc-oai-prod-01',
    name: 'OpenAI-Enterprise-East',
    provider: 'OpenAI',
    modelTier: 'GPT-4o / o1-preview (Tier 5)',
    apiKeyMasked: 'sk-proj-94Fk...81Lz',
    status: 'in_use',
    priority: 1,
    weight: 90,
    quota: {
      usedTokens: 4_850_000,
      totalTokens: 10_000_000,
      rpmCurrent: 420,
      rpmLimit: 10_000,
      tpmCurrent: 285_000,
      tpmLimit: 800_000,
      dailySpentUsd: 28.5,
      dailyBudgetUsd: 120,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 180,
      reason: 'Bình thường',
      triggerTimestamp: '15 phút trước'
    },
    successRate: 99.8,
    lastUsedAt: '2 giây trước',
    totalRequestsToday: 32_450,
    tags: ['Production', 'High-Throughput', 'GPT-4o']
  },
  {
    id: 'acc-gemini-corp-01',
    name: 'Gemini-Ultra-Primary',
    provider: 'Google Gemini',
    modelTier: 'Gemini 1.5 Pro / Flash 2.0',
    apiKeyMasked: 'AIzaSyDn...K9x2',
    status: 'active',
    priority: 1,
    weight: 85,
    quota: {
      usedTokens: 6_200_000,
      totalTokens: 15_000_000,
      rpmCurrent: 180,
      rpmLimit: 2_000,
      tpmCurrent: 195_000,
      tpmLimit: 4_000_000,
      dailySpentUsd: 14.2,
      dailyBudgetUsd: 80,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 120,
      reason: 'Bình thường',
      triggerTimestamp: '42 phút trước'
    },
    successRate: 99.9,
    lastUsedAt: '18 giây trước',
    totalRequestsToday: 24_110,
    tags: ['Production', 'Multimodal', 'Large-Context']
  },
  {
    id: 'acc-claude-api-01',
    name: 'Anthropic-Scale-Tier4',
    provider: 'Anthropic',
    modelTier: 'Claude 3.5 Sonnet / Opus',
    apiKeyMasked: 'sk-ant-api03-Pz9...3Kq',
    status: 'cooldown',
    priority: 2,
    weight: 70,
    quota: {
      usedTokens: 7_120_000,
      totalTokens: 8_000_000,
      rpmCurrent: 980,
      rpmLimit: 1_000,
      tpmCurrent: 395_000,
      tpmLimit: 400_000,
      dailySpentUsd: 46.8,
      dailyBudgetUsd: 75,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: true,
      remainingSeconds: 142,
      totalDurationSeconds: 300,
      reason: '429 Rate Limit (Đạt trần TPM 400k)',
      triggerTimestamp: 'Vừa kích hoạt 2 phút trước'
    },
    successRate: 97.4,
    lastUsedAt: '2 phút trước',
    totalRequestsToday: 19_840,
    tags: ['Coding-Agents', 'Sonnet-3.5']
  },
  {
    id: 'acc-deepseek-v3-01',
    name: 'DeepSeek-V3-Reasoner',
    provider: 'DeepSeek',
    modelTier: 'DeepSeek V3 / R1 Reasoner',
    apiKeyMasked: 'sk-dpsk-39aa...819c',
    status: 'active',
    priority: 1,
    weight: 95,
    quota: {
      usedTokens: 9_450_000,
      totalTokens: 20_000_000,
      rpmCurrent: 320,
      rpmLimit: 5_000,
      tpmCurrent: 210_000,
      tpmLimit: 2_000_000,
      dailySpentUsd: 7.9,
      dailyBudgetUsd: 50,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 90,
      reason: 'Bình thường',
      triggerTimestamp: '1 giờ trước'
    },
    successRate: 99.2,
    lastUsedAt: '5 giây trước',
    totalRequestsToday: 41_200,
    tags: ['Fast-Inference', 'Math-Code', 'Low-Cost']
  },
  {
    id: 'acc-groq-ultra-01',
    name: 'Groq-Llama3-Instant',
    provider: 'Groq',
    modelTier: 'Llama 3.3 70B / Mixtral',
    apiKeyMasked: 'gsk_08mPq...44Vx',
    status: 'active',
    priority: 2,
    weight: 80,
    quota: {
      usedTokens: 3_100_000,
      totalTokens: 10_000_000,
      rpmCurrent: 45,
      rpmLimit: 300,
      tpmCurrent: 60_000,
      tpmLimit: 300_000,
      dailySpentUsd: 3.2,
      dailyBudgetUsd: 30,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 60,
      reason: 'Bình thường',
      triggerTimestamp: '3 giờ trước'
    },
    successRate: 99.7,
    lastUsedAt: '40 giây trước',
    totalRequestsToday: 18_900,
    tags: ['Ultra-Low-Latency', 'Realtime-Voice']
  },
  {
    id: 'acc-oai-prod-02',
    name: 'OpenAI-Enterprise-Backup',
    provider: 'OpenAI',
    modelTier: 'GPT-4o mini / embeddings',
    apiKeyMasked: 'sk-proj-77Yt...99Aw',
    status: 'active',
    priority: 2,
    weight: 60,
    quota: {
      usedTokens: 2_340_000,
      totalTokens: 8_000_000,
      rpmCurrent: 90,
      rpmLimit: 5_000,
      tpmCurrent: 85_000,
      tpmLimit: 500_000,
      dailySpentUsd: 11.4,
      dailyBudgetUsd: 60,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 120,
      reason: 'Sẵn sàng thay thế',
      triggerTimestamp: 'Hôm qua'
    },
    successRate: 99.5,
    lastUsedAt: '3 phút trước',
    totalRequestsToday: 11_300,
    tags: ['Backup', 'Embeddings']
  },
  {
    id: 'acc-gemini-corp-02',
    name: 'Gemini-Batch-Secondary',
    provider: 'Google Gemini',
    modelTier: 'Gemini 1.5 Flash (8B / 1M)',
    apiKeyMasked: 'AIzaSyBn...88Wz',
    status: 'cooldown',
    priority: 3,
    weight: 50,
    quota: {
      usedTokens: 4_900_000,
      totalTokens: 5_000_000,
      rpmCurrent: 14,
      rpmLimit: 15,
      tpmCurrent: 98_000,
      tpmLimit: 100_000,
      dailySpentUsd: 4.8,
      dailyBudgetUsd: 10,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: true,
      remainingSeconds: 58,
      totalDurationSeconds: 180,
      reason: 'Chạm giới hạn 15 RPM Free/Tier 1',
      triggerTimestamp: '2 phút trước'
    },
    successRate: 95.1,
    lastUsedAt: '1 phút trước',
    totalRequestsToday: 6_450,
    tags: ['Batch-Jobs', 'Secondary']
  },
  {
    id: 'acc-mistral-large-01',
    name: 'Mistral-Large-Euro',
    provider: 'Mistral AI',
    modelTier: 'Mistral Large 2 / Codestral',
    apiKeyMasked: 'mis_911ab...67Kk',
    status: 'idle',
    priority: 3,
    weight: 40,
    quota: {
      usedTokens: 1_200_000,
      totalTokens: 6_000_000,
      rpmCurrent: 0,
      rpmLimit: 500,
      tpmCurrent: 0,
      tpmLimit: 200_000,
      dailySpentUsd: 6.2,
      dailyBudgetUsd: 40,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 60,
      reason: 'Chờ xoay vòng',
      triggerTimestamp: '5 giờ trước'
    },
    successRate: 98.9,
    lastUsedAt: '18 phút trước',
    totalRequestsToday: 4_200,
    tags: ['EU-GDPR', 'Code-Completion']
  },
  {
    id: 'acc-claude-api-02',
    name: 'Anthropic-Haiku-Rapid',
    provider: 'Anthropic',
    modelTier: 'Claude 3.5 Haiku',
    apiKeyMasked: 'sk-ant-api03-Lm8...99Rt',
    status: 'quota_exceeded',
    priority: 4,
    weight: 30,
    quota: {
      usedTokens: 5_010_000,
      totalTokens: 5_000_000,
      rpmCurrent: 0,
      rpmLimit: 500,
      tpmCurrent: 0,
      tpmLimit: 100_000,
      dailySpentUsd: 25.0,
      dailyBudgetUsd: 25.0,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 0,
      reason: 'Hết hạn mức ngân sách ngày ($25 / $25)',
      triggerTimestamp: '30 phút trước'
    },
    successRate: 94.8,
    lastUsedAt: '30 phút trước',
    totalRequestsToday: 14_800,
    tags: ['Classification', 'Haiku']
  },
  {
    id: 'acc-deepseek-v3-02',
    name: 'DeepSeek-V3-Mirror',
    provider: 'DeepSeek',
    modelTier: 'DeepSeek V3 (Direct API)',
    apiKeyMasked: 'sk-dpsk-9911...001a',
    status: 'active',
    priority: 2,
    weight: 85,
    quota: {
      usedTokens: 5_100_000,
      totalTokens: 15_000_000,
      rpmCurrent: 140,
      rpmLimit: 3_000,
      tpmCurrent: 110_000,
      tpmLimit: 1_000_000,
      dailySpentUsd: 4.1,
      dailyBudgetUsd: 40,
      resetTime: '00:00 UTC (trong 4h 20m)'
    },
    cooldown: {
      isInCooldown: false,
      remainingSeconds: 0,
      totalDurationSeconds: 90,
      reason: 'Bình thường',
      triggerTimestamp: '2 giờ trước'
    },
    successRate: 99.4,
    lastUsedAt: '12 giây trước',
    totalRequestsToday: 21_600,
    tags: ['Fallback-Reasoner', 'High-Speed']
  }
];

export const TIMELINE_QUOTA_DATA: QuotaTimelinePoint[] = [
  { time: '00:00', tokensUsed: 1.2, limitCap: 6.0, requestsCount: 3200 },
  { time: '02:00', tokensUsed: 0.8, limitCap: 6.0, requestsCount: 1900 },
  { time: '04:00', tokensUsed: 0.6, limitCap: 6.0, requestsCount: 1400 },
  { time: '06:00', tokensUsed: 1.5, limitCap: 6.0, requestsCount: 4100 },
  { time: '08:00', tokensUsed: 3.8, limitCap: 6.0, requestsCount: 9800 },
  { time: '10:00', tokensUsed: 5.4, limitCap: 6.0, requestsCount: 14200 },
  { time: '12:00', tokensUsed: 4.9, limitCap: 6.0, requestsCount: 12500 },
  { time: '14:00', tokensUsed: 5.8, limitCap: 6.0, requestsCount: 15100 },
  { time: '16:00', tokensUsed: 5.2, limitCap: 6.0, requestsCount: 13800 },
  { time: '18:00', tokensUsed: 4.4, limitCap: 6.0, requestsCount: 11200 },
  { time: '20:00', tokensUsed: 3.9, limitCap: 6.0, requestsCount: 9600 },
  { time: 'Now',   tokensUsed: 4.6, limitCap: 6.0, requestsCount: 11900 },
];

export const PROVIDER_SHARES: ProviderQuotaShare[] = [
  { name: 'OpenAI', usedTokens: 7.19, allocatedTokens: 18.0, accountCount: 2, color: '#10b981' },
  { name: 'Google Gemini', usedTokens: 11.1, allocatedTokens: 20.0, accountCount: 2, color: '#3b82f6' },
  { name: 'Anthropic', usedTokens: 12.13, allocatedTokens: 13.0, accountCount: 2, color: '#f59e0b' },
  { name: 'DeepSeek', usedTokens: 14.55, allocatedTokens: 35.0, accountCount: 2, color: '#6366f1' },
  { name: 'Groq', usedTokens: 3.1, allocatedTokens: 10.0, accountCount: 1, color: '#ec4899' },
  { name: 'Mistral AI', usedTokens: 1.2, allocatedTokens: 6.0, accountCount: 1, color: '#14b8a6' },
];

export const ROTATION_QUEUE_PREVIEW = [
  { rank: 1, id: 'acc-oai-prod-01', name: 'OpenAI-Enterprise-East', status: 'in_use', remainingTokensRatio: '51% free', latency: '210ms' },
  { rank: 2, id: 'acc-deepseek-v3-01', name: 'DeepSeek-V3-Reasoner', status: 'active', remainingTokensRatio: '53% free', latency: '190ms' },
  { rank: 3, id: 'acc-gemini-corp-01', name: 'Gemini-Ultra-Primary', status: 'active', remainingTokensRatio: '59% free', latency: '280ms' },
  { rank: 4, id: 'acc-deepseek-v3-02', name: 'DeepSeek-V3-Mirror', status: 'active', remainingTokensRatio: '66% free', latency: '215ms' },
  { rank: 5, id: 'acc-groq-ultra-01', name: 'Groq-Llama3-Instant', status: 'active', remainingTokensRatio: '69% free', latency: '95ms' },
  { rank: 6, id: 'acc-oai-prod-02', name: 'OpenAI-Enterprise-Backup', status: 'active', remainingTokensRatio: '71% free', latency: '230ms' },
];
