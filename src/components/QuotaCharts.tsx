import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { Zap, Activity, Shuffle, Timer } from 'lucide-react';
import { AIAccount, formatDuration, formatTokens } from '../types';
import type { MetricsSummaryDto, ProviderUsageDto, TimelinePointDto } from '../../shared/types';

interface QuotaChartsProps {
  accounts: AIAccount[];
  metrics: MetricsSummaryDto | null;
  timeline: TimelinePointDto[];
  providerUsage: ProviderUsageDto[];
}

export const QuotaCharts: React.FC<QuotaChartsProps> = ({
  accounts,
  metrics,
  timeline,
  providerUsage
}) => {
  const todayTokens = accounts.reduce((sum, a) => sum + a.quota.todayTokens, 0);
  const totalBudget = accounts.reduce((sum, a) => sum + a.quota.dailyTokenBudget, 0);
  const budgetPercent = totalBudget > 0 ? Math.min(100, Math.round((todayTokens / totalBudget) * 100)) : null;

  // Recharts needs plain numbers per series; the timeline buckets carry epoch
  // millis, which are formatted here rather than in the axis so the tooltip and
  // the axis agree.
  const timelineData = timeline.map(point => ({
    time: new Date(point.t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    'Thành công': point.success,
    'Thất bại': point.failed,
    tokens: Math.round((point.promptTokens + point.completionTokens) / 1000)
  }));

  const providerData = providerUsage
    .filter(p => p.accountCount > 0)
    .map(p => ({
      name: p.label,
      Request: p.requests,
      'Token (k)': Math.round((p.promptTokens + p.completionTokens) / 1000)
    }));

  return (
    <div className="space-y-5">
      {/* 4 Key Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Token usage today */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Token hôm nay</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <Zap className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              {formatTokens(todayTokens)}
              {totalBudget > 0 && (
                <span className="text-xs font-normal text-slate-500"> / {formatTokens(totalBudget)}</span>
              )}
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden">
              <div
                className="bg-slate-900 h-full rounded-full transition-all duration-500"
                style={{ width: `${budgetPercent ?? 0}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>
              {budgetPercent === null
                ? 'Chưa đặt hạn mức'
                : <>Đã dùng: <strong className="text-slate-800 font-mono">{budgetPercent}%</strong></>}
            </span>
          </div>
        </div>

        {/* Success rate */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Tỷ lệ thành công (24h)</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <Activity className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              {metrics ? `${metrics.successRate}%` : '—'}
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (metrics?.successRate ?? 100) < 90 ? 'bg-amber-500' : 'bg-emerald-600'
                }`}
                style={{ width: `${metrics?.successRate ?? 0}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>
              {metrics?.totalRequests ?? 0} request
            </span>
            {(metrics?.partialFailures ?? 0) > 0 && (
              <span className="text-amber-700 font-medium">
                {metrics?.partialFailures} đứt stream
              </span>
            )}
          </div>
        </div>

        {/* Failover count */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Số lần chuyển tài khoản</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <Shuffle className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              {metrics?.failoverCount ?? 0}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Lần router phải bỏ một tài khoản và thử tài khoản khác
            </p>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>Thất bại: <strong className="text-slate-800 font-mono">{metrics?.failedRequests ?? 0}</strong></span>
            <span>Hủy: <strong className="text-slate-800 font-mono">{metrics?.cancelledRequests ?? 0}</strong></span>
          </div>
        </div>

        {/* Latency */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Độ trễ</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <Timer className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              {metrics?.avgTtfbMs != null ? formatDuration(metrics.avgTtfbMs) : '—'}
            </div>
            <p className="text-[11px] text-slate-500 mt-1">Trung bình tới byte đầu tiên</p>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>TB: <strong className="text-slate-800 font-mono">{metrics ? formatDuration(metrics.avgLatencyMs) : '—'}</strong></span>
            <span>p95: <strong className="text-slate-800 font-mono">{metrics ? formatDuration(metrics.p95LatencyMs) : '—'}</strong></span>
          </div>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chart 1: Request timeline */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-slate-900">
              Lưu lượng request (24h gần nhất)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Số request thành công và thất bại theo từng khung giờ
            </p>
          </div>

          <div className="h-56 w-full">
            {timelineData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Chưa có dữ liệu
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="okGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f172a" stopOpacity={0.12} />
                      <stop offset="95%" stopColor="#0f172a" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                    labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="Thành công"
                    stroke="#0f172a"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#okGrad)"
                  />
                  <Area
                    type="monotone"
                    dataKey="Thất bại"
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    fillOpacity={0}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Chart 2: Provider usage */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-slate-900">
              Lưu lượng theo nhà cung cấp
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Số request và token đã dùng trong 24h
            </p>
          </div>

          <div className="h-56 w-full">
            {providerData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">
                Chưa có tài khoản nào trong pool
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={providerData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                    labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="Request" fill="#0f172a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Token (k)" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
