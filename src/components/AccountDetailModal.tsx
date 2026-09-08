import React from 'react';
import { 
  X, 
  Key, 
  Hourglass, 
  ShieldCheck, 
  CheckCircle, 
  Zap, 
  RotateCcw
} from 'lucide-react';
import { AIAccount } from '../types';

interface AccountDetailModalProps {
  account: AIAccount | null;
  onClose: () => void;
  onClearCooldown: (id: string) => void;
  onTriggerCooldown: (id: string) => void;
  onMakeActive: (id: string) => void;
  onResetQuota: (id: string) => void;
}

export const AccountDetailModal: React.FC<AccountDetailModalProps> = ({
  account,
  onClose,
  onClearCooldown,
  onTriggerCooldown,
  onMakeActive,
  onResetQuota
}) => {
  if (!account) return null;

  const usedTokensPct = Math.round((account.quota.usedTokens / account.quota.totalTokens) * 100);
  const isCooldown = account.status === 'cooldown' || account.cooldown.isInCooldown;

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return val.toString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div 
        id="account-detail-modal"
        className="w-full max-w-xl bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold">
              <Zap className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{account.name}</h3>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  {account.provider}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                Model: {account.modelTier} • ID: {account.id}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4">
          {/* Status Alert Banner */}
          {isCooldown ? (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Hourglass className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-xs font-semibold text-amber-900">Đang trong thời gian Cooldown (Hồi chiêu)</h4>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Lý do: {account.cooldown.reason}
                  </p>
                  <p className="text-[11px] text-amber-800 font-mono mt-1">
                    Còn lại: <strong>{account.cooldown.remainingSeconds}s</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => onClearCooldown(account.id)}
                className="px-2.5 py-1 rounded bg-amber-600 text-white font-medium text-xs hover:bg-amber-700 transition-colors shrink-0 cursor-pointer"
              >
                Gỡ Cooldown
              </button>
            </div>
          ) : account.status === 'in_use' ? (
            <div className="p-3 rounded-md bg-blue-50 border border-blue-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-blue-600" />
                <div>
                  <h4 className="text-xs font-semibold text-blue-900">Đang nhận traffic chính (Active Serving)</h4>
                  <p className="text-[11px] text-blue-700">Tài khoản này đang xử lý các requests đầu bảng trong pool.</p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Key and Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Key className="h-3.5 w-3.5 text-slate-600" />
                API Key
              </div>
              <div className="font-mono text-xs text-slate-800 bg-white px-2.5 py-1.5 rounded border border-slate-200 select-all">
                {account.apiKeyMasked}
              </div>
              <div className="text-[10px] text-slate-400">
                Mã hóa an toàn trong bộ nhớ
              </div>
            </div>

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
                Tham số xoay vòng
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Mức ưu tiên</span>
                  <span className="font-mono font-semibold text-slate-800">Priority P{account.priority}</span>
                </div>
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Trọng số (Weight)</span>
                  <span className="font-mono font-semibold text-slate-800">{account.weight} / 100</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quota Breakdown */}
          <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Hạn mức Quota chi tiết
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                Reset: {account.quota.resetTime}
              </span>
            </div>

            {/* Progress bar */}
            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-700">
                  Đã dùng: <strong>{formatTokens(account.quota.usedTokens)}</strong> / {formatTokens(account.quota.totalTokens)} Tokens
                </span>
                <span className={`font-semibold ${usedTokensPct > 85 ? 'text-amber-600' : 'text-slate-600'}`}>
                  {usedTokensPct}%
                </span>
              </div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all ${
                    usedTokensPct > 85 ? 'bg-amber-500' : 'bg-slate-800'
                  }`}
                  style={{ width: `${usedTokensPct}%` }}
                />
              </div>
            </div>

            {/* Metrics subgrid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">RPM</span>
                <span className="font-mono font-medium text-slate-800">{account.quota.rpmCurrent} / {account.quota.rpmLimit}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">TPM</span>
                <span className="font-mono font-medium text-slate-800">{formatTokens(account.quota.tpmCurrent)}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Chi tiêu hôm nay</span>
                <span className="font-mono font-medium text-slate-800">${account.quota.dailySpentUsd.toFixed(1)} / ${account.quota.dailyBudgetUsd}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Tỷ lệ thành công</span>
                <span className="font-mono font-medium text-emerald-700">{account.successRate}%</span>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Nhãn phân loại:</div>
            <div className="flex flex-wrap gap-1.5">
              {account.tags.map(tag => (
                <span key={tag} className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 border border-slate-200">
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => onResetQuota(account.id)}
            className="px-2.5 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
            Làm mới Quota
          </button>

          <div className="flex items-center gap-2">
            {account.status !== 'in_use' && (
              <button
                onClick={() => {
                  onMakeActive(account.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="h-3.5 w-3.5" />
                Dùng Làm Slot Chính
              </button>
            )}

            {!isCooldown ? (
              <button
                onClick={() => {
                  onTriggerCooldown(account.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Hourglass className="h-3.5 w-3.5 text-amber-600" />
                Đưa Vào Cooldown
              </button>
            ) : (
              <button
                onClick={() => {
                  onClearCooldown(account.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Gỡ Cooldown Ngay
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
