import React, { useState } from 'react';
import {
  Search,
  Hourglass,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Ban,
  Zap,
  Info,
  X
} from 'lucide-react';
import { AIAccount, formatTokens } from '../types';

interface AccountTableProps {
  accounts: AIAccount[];
  onSelectAccount: (account: AIAccount) => void;
  onTriggerCooldown: (accountId: string) => void;
  onClearCooldown: (accountId: string) => void;
  onMakeActive: (accountId: string) => void;
}

export const AccountTable: React.FC<AccountTableProps> = ({
  accounts,
  onSelectAccount,
  onTriggerCooldown,
  onClearCooldown,
  onMakeActive
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'in_use' | 'cooldown'>('ALL');
  const [providerFilter, setProviderFilter] = useState<string>('ALL');

  // Counts for quick tabs
  const countAll = accounts.length;
  const countActive = accounts.filter(a => a.status === 'active').length;
  const countInUse = accounts.filter(a => a.status === 'in_use').length;
  const countCooldown = accounts.filter(
    a => a.status === 'cooldown' || a.status === 'temp_error' || a.status === 'quota_exceeded'
  ).length;

  // Filter accounts
  const filteredAccounts = accounts.filter(acc => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      acc.name.toLowerCase().includes(term) ||
      acc.modelSummary.toLowerCase().includes(term) ||
      acc.providerLabel.toLowerCase().includes(term) ||
      acc.apiKeyMasked.toLowerCase().includes(term);

    const matchesStatus =
      statusFilter === 'ALL' ? true :
      statusFilter === 'active' ? acc.status === 'active' :
      statusFilter === 'in_use' ? acc.status === 'in_use' :
      statusFilter === 'cooldown'
        ? (acc.status === 'cooldown' || acc.status === 'temp_error' || acc.status === 'quota_exceeded')
        : true;

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
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="groq">Groq</option>
            <option value="mistral">Mistral AI</option>
            <option value="openai_compatible">OpenAI-compatible</option>
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
              <th className="py-2.5 px-4 min-w-[160px]">Token hôm nay</th>
              <th className="py-2.5 px-4 hidden md:table-cell">Request</th>
              <th className="py-2.5 px-4 text-right">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  {accounts.length === 0
                    ? 'Chưa có tài khoản nào. Thêm API key để router bắt đầu định tuyến.'
                    : 'Không tìm thấy tài khoản nào phù hợp với bộ lọc.'}
                </td>
              </tr>
            ) : (
              filteredAccounts.map((acc) => {
                const isCooldown = acc.status === 'cooldown';
                const isTempError = acc.status === 'temp_error';
                const isQuotaExceeded = acc.status === 'quota_exceeded';
                const isDisabled = acc.status === 'disabled';
                const isInUse = acc.status === 'in_use';
                const isHeld = isCooldown || isTempError || isQuotaExceeded;
                const usedPct = acc.quota.usedPercent;

                return (
                  <tr
                    key={acc.id}
                    id={`account-row-${acc.id}`}
                    className={`hover:bg-slate-50 transition-colors ${
                      isInUse ? 'bg-blue-50/30' : isHeld ? 'bg-amber-50/20' : isDisabled ? 'bg-slate-50/60' : ''
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
                            {acc.providerLabel}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                          <span>{acc.modelSummary}</span>
                          <span className="text-slate-300">•</span>
                          <span className="font-mono text-slate-400 text-[10px]">{acc.apiKeyMasked}</span>
                        </div>
                      </div>
                    </td>

                    {/* Status Badge */}
                    <td className="py-3 px-4">
                      {isDisabled ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                          <Ban className="h-3 w-3" />
                          Đã tắt
                        </span>
                      ) : isInUse ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
                          Đang phục vụ ({acc.inFlight})
                        </span>
                      ) : isTempError ? (
                        <div
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200"
                          title={acc.cooldown.reason}
                        >
                          <AlertTriangle className="h-3 w-3 text-orange-600" />
                          <span>Lỗi tạm ({acc.cooldown.remainingSeconds}s)</span>
                        </div>
                      ) : isQuotaExceeded ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle className="h-3 w-3" />
                          Hết hạn mức ngày
                        </span>
                      ) : isCooldown ? (
                        <div
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200"
                          title={acc.cooldown.reason}
                        >
                          <Hourglass className="h-3 w-3 text-amber-600" />
                          <span>Hồi chiêu ({acc.cooldown.remainingSeconds}s)</span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                          Sẵn sàng
                        </span>
                      )}
                    </td>

                    {/* Token usage today */}
                    <td className="py-3 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="text-slate-700">
                            {formatTokens(acc.quota.todayTokens)}
                            {acc.quota.dailyTokenBudget > 0 && (
                              <span className="text-slate-400"> / {formatTokens(acc.quota.dailyTokenBudget)}</span>
                            )}
                          </span>
                          {usedPct !== null && (
                            <span className={`font-semibold ${usedPct > 80 ? 'text-amber-600' : 'text-slate-600'}`}>
                              {usedPct}%
                            </span>
                          )}
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              usedPct !== null && usedPct > 80 ? 'bg-amber-500' : 'bg-slate-700'
                            }`}
                            style={{ width: `${usedPct ?? 0}%` }}
                          />
                        </div>
                        {acc.quota.dailyTokenBudget === 0 && (
                          <div className="text-[10px] text-slate-400">Không đặt hạn mức</div>
                        )}
                      </div>
                    </td>

                    {/* Request counters */}
                    <td className="py-3 px-4 hidden md:table-cell font-mono text-[11px] text-slate-700">
                      <span>{acc.quota.todayRequests}</span>
                      <span className="text-slate-400"> hôm nay</span>
                      <div className={`text-[10px] ${acc.successRate < 90 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {acc.successRate}% thành công
                      </div>
                    </td>

                    {/* Quick Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Re-enable a disabled credential */}
                        {isDisabled && (
                          <button
                            id={`btn-make-active-${acc.id}`}
                            onClick={() => onMakeActive(acc.id)}
                            title="Bật lại tài khoản này"
                            className="px-2 py-1 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                          >
                            <Zap className="h-3 w-3 text-slate-500" />
                            <span className="hidden sm:inline">Bật lại</span>
                          </button>
                        )}

                        {/* Cooldown Toggle */}
                        {isHeld ? (
                          <button
                            id={`btn-clear-cd-${acc.id}`}
                            onClick={() => onClearCooldown(acc.id)}
                            title="Gỡ Cooldown lập tức"
                            className="px-2 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            <span>Gỡ chờ</span>
                          </button>
                        ) : !isDisabled ? (
                          <button
                            id={`btn-trigger-cd-${acc.id}`}
                            onClick={() => onTriggerCooldown(acc.id)}
                            title="Tạm rút tài khoản khỏi pool 120 giây"
                            className="p-1 rounded-md text-slate-400 hover:text-amber-600 hover:bg-slate-100 transition-colors cursor-pointer"
                          >
                            <Hourglass className="h-3.5 w-3.5" />
                          </button>
                        ) : null}

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
