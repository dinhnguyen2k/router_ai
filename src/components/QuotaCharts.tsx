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
  Bar
} from 'recharts';
import { TIMELINE_QUOTA_DATA, PROVIDER_SHARES } from '../mockData';
import { AIAccount } from '../types';
import { Zap, DollarSign } from 'lucide-react';

interface QuotaChartsProps {
  accounts: AIAccount[];
}

export const QuotaCharts: React.FC<QuotaChartsProps> = ({ accounts }) => {
  const totalUsedTokens = accounts.reduce((acc, a) => acc + a.quota.usedTokens, 0);
  const totalLimitTokens = accounts.reduce((acc, a) => acc + a.quota.totalTokens, 0);
  const totalSpentUsd = accounts.reduce((acc, a) => acc + a.quota.dailySpentUsd, 0);
  const totalBudgetUsd = accounts.reduce((acc, a) => acc + a.quota.dailyBudgetUsd, 0);

  const usagePercent = Math.round((totalUsedTokens / totalLimitTokens) * 100);
  const budgetPercent = Math.round((totalSpentUsd / totalBudgetUsd) * 100);

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return val.toString();
  };

  const providerChartData = PROVIDER_SHARES.map(p => ({
    name: p.name,
    'Đã dùng': p.usedTokens,
    'Hạn mức cấp': p.allocatedTokens
  }));

  return (
    <div className="space-y-5">
      {/* 2 Key Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Token Quota Progress */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Tổng hạn mức Token trong Pool</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <Zap className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              {formatTokens(totalUsedTokens)} <span className="text-xs font-normal text-slate-500">/ {formatTokens(totalLimitTokens)} Tokens</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden">
              <div 
                className="bg-slate-900 h-full rounded-full transition-all duration-500" 
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>Đã tiêu thụ: <strong className="text-slate-800 font-mono">{usagePercent}%</strong></span>
            <span>Còn lại: <strong className="text-emerald-700 font-mono">{formatTokens(totalLimitTokens - totalUsedTokens)}</strong></span>
          </div>
        </div>

        {/* Daily Budget Spent */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-medium">Ngân sách tiêu thụ trong ngày (USD)</span>
            <span className="p-1 rounded-md bg-slate-100 text-slate-700">
              <DollarSign className="h-3.5 w-3.5" />
            </span>
          </div>

          <div className="my-2.5">
            <div className="text-xl font-bold font-mono text-slate-900">
              ${totalSpentUsd.toFixed(2)} <span className="text-xs font-normal text-slate-500">/ ${totalBudgetUsd.toFixed(0)} USD</span>
            </div>
            <div className="w-full bg-slate-100 h-2 rounded-full mt-2.5 overflow-hidden">
              <div 
                className="bg-emerald-600 h-full rounded-full transition-all duration-500" 
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
            <span>Tỷ lệ ngân sách: <strong className="text-emerald-700 font-mono">{budgetPercent}%</strong></span>
            <span>Làm mới định kỳ: <strong className="text-slate-700 font-mono">00:00 UTC</strong></span>
          </div>
        </div>
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chart 1: Hourly Usage Timeline */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-slate-900">
              Tiêu thụ Token theo giờ (24h gần nhất)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Lưu lượng token sử dụng theo từng khung giờ
            </p>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TIMELINE_QUOTA_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f172a" stopOpacity={0.12}/>
                    <stop offset="95%" stopColor="#0f172a" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="time" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                  labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                  formatter={(value: any) => [`${value}k tokens`, 'Lưu lượng']}
                />
                <Area 
                  type="monotone" 
                  dataKey="tokens" 
                  stroke="#0f172a" 
                  strokeWidth={1.5}
                  fillOpacity={1} 
                  fill="url(#tokenGrad)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Provider Allocation */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-slate-900">
              Hạn mức theo nhà cung cấp (Triệu Tokens)
            </h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              So sánh hạn mức đã cấp và lượng token đã dùng
            </p>
          </div>

          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={providerChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 11, fill: '#64748b' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '6px', fontSize: '11px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
                  labelStyle={{ color: '#0f172a', fontWeight: 600 }}
                  formatter={(value: any, name: any) => [`${value}M tokens`, name]}
                />
                <Bar dataKey="Hạn mức cấp" fill="#e2e8f0" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Đã dùng" fill="#0f172a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
