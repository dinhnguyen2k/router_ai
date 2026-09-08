/**
 * Request log storage and the metric rollups the dashboard reads.
 *
 * Metrics are computed from the log table rather than kept as running counters,
 * so a restart cannot leave a counter and its underlying rows disagreeing, and
 * so any window the dashboard asks for is answerable without pre-aggregation.
 */

import type { Db } from './index.js';
import type {
  MetricsSummaryDto,
  ProviderId,
  ProviderUsageDto,
  RequestAttemptDto,
  RequestLogDto,
  TimelinePointDto,
} from '../../shared/types.js';
import { PROVIDERS } from '../providers/registry.js';

interface LogRow {
  id: string;
  created_at: number;
  protocol: string;
  model: string;
  stream: number;
  outcome: string;
  status: number | null;
  account_id: string | null;
  account_name: string | null;
  duration_ms: number;
  ttfb_ms: number | null;
  attempt_count: number;
  attempts: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  error_class: string | null;
  error_message: string | null;
}

function rowToDto(row: LogRow): RequestLogDto {
  let attempts: RequestAttemptDto[] = [];
  try {
    const parsed = JSON.parse(row.attempts) as unknown;
    if (Array.isArray(parsed)) attempts = parsed as RequestAttemptDto[];
  } catch {
    attempts = [];
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    protocol: row.protocol as RequestLogDto['protocol'],
    model: row.model,
    stream: row.stream === 1,
    outcome: row.outcome as RequestLogDto['outcome'],
    status: row.status,
    accountId: row.account_id,
    accountName: row.account_name,
    durationMs: row.duration_ms,
    ttfbMs: row.ttfb_ms,
    attemptCount: row.attempt_count,
    attempts,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    errorClass: row.error_class as RequestLogDto['errorClass'],
    errorMessage: row.error_message,
  };
}

export class LogStore {
  constructor(private readonly db: Db) {}

  insert(entry: RequestLogDto): void {
    this.db
      .prepare(
        `INSERT INTO request_logs
           (id, created_at, protocol, model, stream, outcome, status, account_id,
            account_name, duration_ms, ttfb_ms, attempt_count, attempts,
            prompt_tokens, completion_tokens, error_class, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.createdAt,
        entry.protocol,
        entry.model,
        entry.stream ? 1 : 0,
        entry.outcome,
        entry.status,
        entry.accountId,
        entry.accountName,
        entry.durationMs,
        entry.ttfbMs,
        entry.attemptCount,
        JSON.stringify(entry.attempts),
        entry.promptTokens,
        entry.completionTokens,
        entry.errorClass,
        entry.errorMessage,
      );
  }

  list(options: {
    limit?: number;
    before?: number;
    outcome?: string;
    accountId?: string;
  } = {}): RequestLogDto[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.before !== undefined) {
      clauses.push('created_at < ?');
      params.push(options.before);
    }
    if (options.outcome !== undefined && options.outcome !== 'all') {
      clauses.push('outcome = ?');
      params.push(options.outcome);
    }
    if (options.accountId !== undefined) {
      clauses.push('account_id = ?');
      params.push(options.accountId);
    }

    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.db
      .prepare(`SELECT * FROM request_logs ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as LogRow[];
    return rows.map(rowToDto);
  }

  /**
   * Aggregates a rolling window.
   *
   * p95 is read off the sorted duration list rather than approximated, because
   * a local pool produces few enough rows per window that an exact percentile
   * costs nothing and an approximate one would be misleading at low volume.
   */
  summary(windowMs: number, now = Date.now()): MetricsSummaryDto {
    const since = now - windowMs;
    const rows = this.db
      .prepare(
        `SELECT outcome, duration_ms, ttfb_ms, attempt_count, prompt_tokens, completion_tokens
         FROM request_logs WHERE created_at >= ?`,
      )
      .all(since) as Array<{
      outcome: string;
      duration_ms: number;
      ttfb_ms: number | null;
      attempt_count: number;
      prompt_tokens: number | null;
      completion_tokens: number | null;
    }>;

    const summary: MetricsSummaryDto = {
      windowMs,
      totalRequests: rows.length,
      successRequests: 0,
      failedRequests: 0,
      cancelledRequests: 0,
      partialFailures: 0,
      failoverCount: 0,
      successRate: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      avgTtfbMs: null,
      promptTokens: 0,
      completionTokens: 0,
    };
    if (rows.length === 0) return summary;

    const durations: number[] = [];
    let ttfbTotal = 0;
    let ttfbCount = 0;
    let durationTotal = 0;

    for (const row of rows) {
      switch (row.outcome) {
        case 'success':
          summary.successRequests += 1;
          break;
        case 'cancelled':
          summary.cancelledRequests += 1;
          break;
        case 'partial_failure':
          summary.partialFailures += 1;
          summary.failedRequests += 1;
          break;
        default:
          summary.failedRequests += 1;
      }
      // An attempt count above one means at least one credential was tried and
      // abandoned, which is exactly what a failover is.
      if (row.attempt_count > 1) summary.failoverCount += row.attempt_count - 1;

      durations.push(row.duration_ms);
      durationTotal += row.duration_ms;
      if (row.ttfb_ms !== null) {
        ttfbTotal += row.ttfb_ms;
        ttfbCount += 1;
      }
      summary.promptTokens += row.prompt_tokens ?? 0;
      summary.completionTokens += row.completion_tokens ?? 0;
    }

    durations.sort((a, b) => a - b);
    // Cancellations are excluded from the success rate: the client chose to
    // stop, which is not the router failing.
    const decided = rows.length - summary.cancelledRequests;
    summary.successRate =
      decided <= 0 ? 0 : Math.round((summary.successRequests / decided) * 1000) / 10;
    summary.avgLatencyMs = Math.round(durationTotal / rows.length);
    summary.p95LatencyMs = durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))];
    summary.avgTtfbMs = ttfbCount === 0 ? null : Math.round(ttfbTotal / ttfbCount);
    return summary;
  }

  /** Buckets the window into a fixed number of points for the charts. */
  timeline(windowMs: number, buckets: number, now = Date.now()): TimelinePointDto[] {
    const since = now - windowMs;
    const size = Math.max(1, Math.floor(windowMs / buckets));
    const points: TimelinePointDto[] = [];
    for (let i = 0; i < buckets; i += 1) {
      points.push({
        t: since + i * size,
        requests: 0,
        success: 0,
        failed: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
    }

    const rows = this.db
      .prepare(
        `SELECT created_at, outcome, prompt_tokens, completion_tokens
         FROM request_logs WHERE created_at >= ?`,
      )
      .all(since) as Array<{
      created_at: number;
      outcome: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
    }>;

    for (const row of rows) {
      const index = Math.min(buckets - 1, Math.floor((row.created_at - since) / size));
      if (index < 0) continue;
      const point = points[index];
      point.requests += 1;
      if (row.outcome === 'success') point.success += 1;
      else if (row.outcome !== 'cancelled') point.failed += 1;
      point.promptTokens += row.prompt_tokens ?? 0;
      point.completionTokens += row.completion_tokens ?? 0;
    }
    return points;
  }

  /**
   * Per-provider usage over the window.
   *
   * Joined against accounts so a provider still shows up with its configured
   * credential count even when it served no traffic in the window.
   */
  providerUsage(
    windowMs: number,
    now = Date.now(),
  ): ProviderUsageDto[] {
    const since = now - windowMs;
    const rows = this.db
      .prepare(
        `SELECT a.provider AS provider,
                COUNT(DISTINCT a.id) AS account_count,
                COUNT(l.id) AS requests,
                COALESCE(SUM(l.prompt_tokens), 0) AS prompt_tokens,
                COALESCE(SUM(l.completion_tokens), 0) AS completion_tokens
         FROM accounts a
         LEFT JOIN request_logs l
           ON l.account_id = a.id AND l.created_at >= ?
         GROUP BY a.provider`,
      )
      .all(since) as Array<{
      provider: string;
      account_count: number;
      requests: number;
      prompt_tokens: number;
      completion_tokens: number;
    }>;

    return rows.map((row) => {
      const provider = row.provider as ProviderId;
      return {
        provider,
        label: PROVIDERS[provider]?.label ?? row.provider,
        accountCount: row.account_count,
        requests: row.requests,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
      };
    });
  }

  /** Drops rows past the retention horizon. Called on a timer. */
  prune(retentionDays: number, now = Date.now()): number {
    const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db.prepare('DELETE FROM request_logs WHERE created_at < ?').run(cutoff);
    return result.changes;
  }
}
