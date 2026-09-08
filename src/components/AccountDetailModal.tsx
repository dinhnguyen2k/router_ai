import React from 'react';
import {
  X,
  Key,
  Hourglass,
  ShieldCheck,
  CheckCircle,
  Zap,
  Ban,
  Trash2,
  AlertTriangle
} from 'lucide-react';
import {
  AIAccount,
  ERROR_CLASS_LABELS,
  formatRelativeTime,
  formatTokens
} from '../types';

interface AccountDetailModalProps {
  account: AIAccount | null;
  onClose: () => void;
  onClearCooldown: (id: string) => void;
  onTriggerCooldown: (id: string) => void;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
}

export const AccountDetailModal: React.FC<AccountDetailModalProps> = ({
  account,
  onClose,
  onClearCooldown,
  onTriggerCooldown,
  onToggleEnabled,
  onDelete
}) => {
  if (!account) return null;

  const usedPct = account.quota.usedPercent;
  const isHeld =
    account.status === 'cooldown' ||
    account.status === 'temp_error' ||
    account.status === 'quota_exceeded';

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
                  {account.providerLabel}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono truncate max-w-[380px]">
                {account.baseUrl}
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
          {account.status === 'disabled' ? (
            <div className="p-3 rounded-md bg-slate-100 border border-slate-200 flex items-start gap-2.5">
              <Ban className="h-4 w-4 text-slate-500 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-xs font-semibold text-slate-800">Tài khoản đang tắt</h4>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  {account.lastError ?? 'Router sẽ không định tuyến request tới tài khoản này.'}
                </p>
              </div>
            </div>
          ) : isHeld ? (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-200 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                {account.status === 'temp_error' ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                ) : (
                  <Hourglass className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                )}
                <div>
                  <h4 className="text-xs font-semibold text-amber-900">
                    {account.status === 'quota_exceeded'
                      ? 'Đã dùng hết hạn mức token trong ngày'
                      : account.status === 'temp_error'
                        ? 'Tạm ngưng do lỗi upstream'
                        : 'Đang trong thời gian Cooldown'}
                  </h4>
                  {account.cooldown.reason && (
                    <p className="text-[11px] text-amber-700 mt-0.5">
                      Lý do: {account.cooldown.reason}
                    </p>
                  )}
                  {account.cooldown.remainingSeconds > 0 && (
                    <p className="text-[11px] text-amber-800 font-mono mt-1">
                      Còn lại: <strong>{account.cooldown.remainingSeconds}s</strong>
                      {account.cooldown.backoffLevel > 0 && (
                        <span className="text-amber-600"> • bậc backoff {account.cooldown.backoffLevel}</span>
                      )}
                    </p>
                  )}
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
                  <h4 className="text-xs font-semibold text-blue-900">Đang xử lý request</h4>
                  <p className="text-[11px] text-blue-700">
                    {account.inFlight} / {account.maxConcurrent} slot đồng thời đang bận.
                  </p>
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
                Mã hóa AES-256-GCM trong SQLite
              </div>
            </div>

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-slate-600" />
                Tham số định tuyến
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Mức ưu tiên</span>
                  <span className="font-mono font-semibold text-slate-800">P{account.priority}</span>
                </div>
                <div className="p-2 rounded bg-white border border-slate-200">
                  <span className="text-slate-500 block text-[10px]">Trọng số</span>
                  <span className="font-mono font-semibold text-slate-800">{account.weight} / 100</span>
                </div>
              </div>
            </div>
          </div>

          {/* Usage Breakdown */}
          <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Mức sử dụng hôm nay
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                Reset: 00:00 UTC
              </span>
            </div>

            <div>
              <div className="flex justify-between text-xs font-mono mb-1">
                <span className="text-slate-700">
                  Đã dùng: <strong>{formatTokens(account.quota.todayTokens)}</strong>
                  {account.quota.dailyTokenBudget > 0
                    ? ` / ${formatTokens(account.quota.dailyTokenBudget)} tokens`
                    : ' tokens (không giới hạn)'}
                </span>
                {usedPct !== null && (
                  <span className={`font-semibold ${usedPct > 85 ? 'text-amber-600' : 'text-slate-600'}`}>
                    {usedPct}%
                  </span>
                )}
              </div>
              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usedPct !== null && usedPct > 85 ? 'bg-amber-500' : 'bg-slate-800'
                  }`}
                  style={{ width: `${usedPct ?? 0}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Request hôm nay</span>
                <span className="font-mono font-medium text-slate-800">{account.quota.todayRequests}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Đang chạy</span>
                <span className="font-mono font-medium text-slate-800">
                  {account.inFlight} / {account.maxConcurrent}
                </span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Tổng request</span>
                <span className="font-mono font-medium text-slate-800">{account.totalRequests}</span>
              </div>
              <div className="p-2 rounded bg-white border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Tỷ lệ thành công</span>
                <span className={`font-mono font-medium ${account.successRate < 90 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {account.successRate}%
                </span>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
              Lần dùng gần nhất: <span className="font-mono">{formatRelativeTime(account.lastUsedAt)}</span>
            </div>
          </div>

          {/* Per-model cooldowns */}
          {account.cooldowns.length > 0 && (
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-2">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                Cooldown theo từng model
              </div>
              <div className="space-y-1.5">
                {account.cooldowns.map(record => (
                  <div
                    key={record.model || '__all__'}
                    className="flex items-center justify-between text-xs bg-white px-2.5 py-1.5 rounded border border-slate-200"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-slate-800">
                        {record.model === '' ? 'Toàn bộ tài khoản' : record.model}
                      </span>
                      <span className="text-slate-400 text-[10px] block truncate">
                        {ERROR_CLASS_LABELS[record.errorClass]} • {record.reason}
                      </span>
                    </div>
                    <span className="font-mono text-amber-700 text-[11px] shrink-0 ml-2">
                      {Math.max(0, Math.ceil((record.nextRetryAt - Date.now()) / 1000))}s
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Models */}
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1.5">Model phục vụ:</div>
            <div className="flex flex-wrap gap-1.5">
              {account.models.length === 0 ? (
                <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600 border border-slate-200">
                  Mọi model
                </span>
              ) : (
                account.models.map(model => (
                  <span key={model} className="px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-600 border border-slate-200">
                    {model}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Tags */}
          {account.tags.length > 0 && (
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
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <button
            onClick={() => {
              onDelete(account.id);
              onClose();
            }}
            className="px-2.5 py-1.5 rounded-md bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Xóa tài khoản
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onToggleEnabled(account.id, !account.enabled);
                onClose();
              }}
              className="px-3 py-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {account.enabled ? <Ban className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
              {account.enabled ? 'Tắt tài khoản' : 'Bật lại'}
            </button>

            {!isHeld ? (
              <button
                onClick={() => {
                  onTriggerCooldown(account.id);
                  onClose();
                }}
                className="px-3 py-1.5 rounded-md bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Hourglass className="h-3.5 w-3.5 text-amber-600" />
                Tạm rút khỏi Pool
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
