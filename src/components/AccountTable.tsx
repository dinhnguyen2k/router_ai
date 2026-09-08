import React, { useState } from 'react';
import { 
  Search, 
  Hourglass, 
  CheckCircle2, 
  AlertCircle, 
  Zap, 
  Info,
  X
} from 'lucide-react';
import { AIAccount, ProviderType } from '../types';

interface AccountTableProps {
  accounts: AIAccount[];
  onSelectAccount: (account: AIAccount) => void;
  onToggleStatus: (accountId: string) => void;
  onTriggerCooldown: (accountId: string) => void;
  onClearCooldown: (accountId: string) => void;
  onMakeActive: (accountId: string) => void;
}

export const AccountTable: React.FC<AccountTableProps> = ({
  accounts,
  onSelectAccount,
  onToggleStatus,
  onTriggerCooldown,
  onClearCooldown,
  onMakeActive
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'in_use' | 'cooldown'>('ALL');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return val.toString();
  };

  // Counts for quick tabs
  const countAll = accounts.length;
  const countActive = accounts.filter(a => a.status === 'active').length;
  const countInUse = accounts.filter(a => a.status === 'in_use').length;
  const countCooldown = accounts.filter(a => a.status === 'cooldown' || a.cooldown.isInCooldown).length;

  // Filter accounts
  const filteredAccounts = accounts.filter(acc => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      acc.name.toLowerCase().includes(term) ||
      acc.modelTier.toLowerCase().includes(term) ||
      acc.provider.toLowerCase().includes(term) ||
      acc.apiKeyMasked.toLowerCase().includes(term);

    const matchesStatus = 
      statusFilter === 'ALL' ? true :
      statusFilter === 'active' ? acc.status === 'active' :
      statusFilter === 'in_use' ? acc.status === 'in_use' :
      statusFilter === 'cooldown' ? (acc.status === 'cooldown' || acc.cooldown.isInCooldown) : true;

    const matchesProvider = providerFilter === 'ALL' || acc.provider === providerFilter;

    return matchesSearch && matchesStatus && matchesProvider;
  });

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
      {/* Header with Search and Quick Status Filter Tabs */}
      <div className="p-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <button
            id="tab-filter-all"
            onClick={() => setStatusFilter('ALL')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              statusFilter === 'ALL' 
                ? 'bg-slate-900 text-white font-semibold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Tất cả
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
              statusFilter === 'ALL' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
            }`}>
              {countAll}
            </span>
          </button>

          <button
            id="tab-filter-in-use"
            onClick={() => setStatusFilter('in_use')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              statusFilter === 'in_use' 
                ? 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            Đang phục vụ
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-mono">
              {countInUse}
            </span>
          </button>

          <button
            id="tab-filter-active"
            onClick={() => setStatusFilter('active')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              statusFilter === 'active' 
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Sẵn sàng
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-mono">
              {countActive}
            </span>
          </button>

          <button
            id="tab-filter-cooldown"
            onClick={() => setStatusFilter('cooldown')}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
              statusFilter === 'cooldown' 
                ? 'bg-amber-50 text-amber-700 border border-amber-200 font-semibold' 
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Hourglass className="h-3 w-3 text-amber-600" />
            Cooldown
            <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 text-slate-600 font-mono">
              {countCooldown}
            </span>
          </button>
        </div>

        {/* Search & Provider dropdown */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-52">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              id="search-account-input"
              type="text"
              placeholder="Tìm kiếm tài khoản..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            id="filter-provider-select"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-700 focus:outline-hidden focus:border-slate-400 cursor-pointer"
          >
            <option value="ALL">Tất cả Provider</option>
            <option value="OpenAI">OpenAI</option>
            <option value="Google Gemini">Gemini</option>
            <option value="Anthropic">Anthropic</option>
            <option value="DeepSeek">DeepSeek</option>
            <option value="Groq">Groq</option>
            <option value="Mistral AI">Mistral</option>
          </select>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              <th className="py-2.5 px-4">Tài khoản & Model</th>
              <th className="py-2.5 px-4">Trạng thái</th>
              <th className="py-2.5 px-4 min-w-[160px]">Hạn mức Token</th>
              <th className="py-2.5 px-4 hidden md:table-cell">Tải RPM</th>
              <th className="py-2.5 px-4 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  Không tìm thấy tài khoản nào phù hợp với bộ lọc.
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => {
                const isCooldown = acc.status === 'cooldown' || acc.cooldown.isInCooldown;
                const isInUse = acc.status === 'in_use';
                const usedPct = Math.round((acc.quota.usedTokens / acc.quota.totalTokens) * 100);

                return (
                  <tr 
                    key={acc.id}
                    id={`account-row-${acc.id}`}
                    className={`hover:bg-slate-50 transition-colors ${
                      isInUse ? 'bg-blue-50/30' : isCooldown ? 'bg-amber-50/20' : ''
                    }`}
                  >
                    {/* Account Name & Info */}
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onSelectAccount(acc)}
                            className="font-semibold text-slate-900 hover:text-blue-600 text-left transition-colors cursor-pointer"
                          >
                            {acc.name}
                          </button>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded border bg-slate-50 text-slate-600 border-slate-200">
                            {acc.provider}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <span>{acc.modelTier}</span>
                          <span className="text-slate-300">•</span>
                          <span className="font-mono text-slate-400 text-[10px]">{acc.apiKeyMasked}</span>
                        </div>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4">
                      {isInUse ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                          Đang phục vụ
                        </span>
                      ) : isCooldown ? (
                        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          <Hourglass className="h-3 w-3 text-amber-600" />
                          <span>Hồi chiêu ({acc.cooldown.remainingSeconds}s)</span>
                        </div>
                      ) : acc.status === 'quota_exceeded' ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle className="h-3 w-3" />
                          Hết Quota
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                          Sẵn sàng
                        </span>
                      )}
                    </td>

                    {/* Quota Progress */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-700">
                            {formatTokens(acc.quota.usedTokens)} <span className="text-slate-400">/ {formatTokens(acc.quota.totalTokens)}</span>
                          </span>
                          <span className={`font-semibold ${usedPct > 80 ? 'text-amber-600' : 'text-slate-600'}`}>
                            {usedPct}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${
                              usedPct > 80 ? 'bg-amber-500' : 'bg-slate-700'
                            }`}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* RPM Load */}
                    <td className="py-3 px-4 hidden md:table-cell font-mono text-[11px] text-slate-700">
                      <span>{acc.quota.rpmCurrent}</span> 
                      <span className="text-slate-400"> / {acc.quota.rpmLimit} RPM</span>
                    </td>

                    {/* Quick Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Make Active Button */}
                        {!isInUse && acc.status !== 'quota_exceeded' && !isCooldown && (
                          <button
                            id={`btn-make-active-${acc.id}`}
                            onClick={() => onMakeActive(acc.id)}
                            title="Chọn làm tài khoản phục vụ chính ngay"
                            className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                          >
                            <Zap className="h-3 w-3 text-slate-500" />
                            <span className="hidden sm:inline">Dùng ngay</span>
                          </button>
                        )}

                        {/* Cooldown Toggle */}
                        {isCooldown ? (
                          <button
                            id={`btn-clear-cd-${acc.id}`}
                            onClick={() => onClearCooldown(acc.id)}
                            title="Gỡ Cooldown lập tức"
                            className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>Gỡ chờ</span>
                          </button>
                        ) : (
                          <button
                            id={`btn-trigger-cd-${acc.id}`}
                            onClick={() => onTriggerCooldown(acc.id)}
                            title="Thử đưa vào Cooldown (Giả lập 429)"
                            className="p-1 rounded-md text-slate-400 hover:text-amber-600 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Hourglass className="h-3.5 w-3.5" />
                          </button>
                        )}

                        {/* Detail Modal Button */}
                        <button
                          id={`btn-detail-${acc.id}`}
                          onClick={() => onSelectAccount(acc)}
                          title="Xem chi tiết"
                          className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
