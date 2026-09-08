import React from 'react';
import { 
  Hourglass, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Flame, 
  ShieldAlert, 
  RotateCcw,
  Zap,
  Info
} from 'lucide-react';
import { AIAccount } from '../types';

interface CooldownViewProps {
  accounts: AIAccount[];
  onClearCooldown: (id: string) => void;
  onClearAllCooldowns: () => void;
  onTriggerCooldown: (id: string) => void;
}

export const CooldownView: React.FC<CooldownViewProps> = ({
  accounts,
  onClearCooldown,
  onClearAllCooldowns,
  onTriggerCooldown
}) => {
  const cooldownAccounts = accounts.filter(a => a.status === 'cooldown' || a.cooldown.isInCooldown);
  const readyAccounts = accounts.filter(a => a.status === 'active' || a.status === 'in_use');

  return (
    <div className="space-y-6">
      {/* Overview Banner */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Hourglass className="h-5 w-5 animate-spin-slow" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-slate-100">
                Theo Dõi Cooldown & Hồi Chiêu Rate Limit
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Quản lý thời gian chờ an toàn sau khi chạm giới hạn 429 RPM/TPM của các nhà cung cấp
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cooldownAccounts.length > 0 && (
            <button
              onClick={onClearAllCooldowns}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-600/30 transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle className="h-4 w-4" />
              Gỡ Hồi Chiêu Tất Cả ({cooldownAccounts.length})
            </button>
          )}
        </div>
      </div>

      {/* Active Cooldown Grid */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          <span>Tài Khoản Đang Chờ Cooldown ({cooldownAccounts.length})</span>
          {cooldownAccounts.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
          )}
        </h3>

        {cooldownAccounts.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
            <CheckCircle className="h-8 w-8 text-emerald-400 mx-auto" />
            <p className="text-sm font-semibold text-slate-200">Không có tài khoản nào bị nghẽn hoặc Rate-limited</p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Tất cả tài khoản trong pool đều hoạt động ổn định và sẵn sàng tiếp nhận request.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cooldownAccounts.map((acc) => {
              const totalDuration = acc.cooldown.totalDurationSeconds || 180;
              const remaining = acc.cooldown.remainingSeconds;
              const progressPct = Math.round(((totalDuration - remaining) / totalDuration) * 100);

              return (
                <div 
                  key={acc.id}
                  className="p-5 rounded-2xl bg-amber-950/20 border border-amber-500/30 shadow-lg shadow-amber-950/20 space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100">{acc.name}</span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold">
                          {acc.provider}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{acc.modelTier}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-bold font-mono text-amber-300">
                        {remaining}s
                      </div>
                      <span className="text-[10px] text-slate-500 block">thời gian còn lại</span>
                    </div>
                  </div>

                  {/* Cooldown Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Tiến trình hồi chiêu: <strong>{progressPct}%</strong></span>
                      <span>Tổng chu kỳ: {totalDuration}s</span>
                    </div>
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div 
                        className="bg-amber-400 h-full rounded-full transition-all duration-1000"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Cooldown Reason Card */}
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-1">
                    <div className="text-slate-400 font-medium">Nguyên nhân kích hoạt:</div>
                    <div className="text-amber-300 font-mono flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      <span>{acc.cooldown.reason}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 pt-1">
                      Thời điểm: {acc.cooldown.triggerTimestamp}
                    </div>
                  </div>

                  {/* Action */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-400">
                      Tự động gỡ và đưa vào pool khi hết đếm lùi
                    </span>
                    <button
                      onClick={() => onClearCooldown(acc.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Bỏ Qua & Gỡ Ngay
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ready Accounts to Test Trigger Cooldown */}
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800/90 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-200">
              Thử Nghiệm Cơ Chế Tự Động Cooldown (Simulator)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Kích hoạt giả lập rate limit 429 lên tài khoản đang hoạt động để kiểm tra khả năng tự chuyển mạch (failover)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {readyAccounts.map((acc) => (
            <div 
              key={acc.id}
              className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-semibold text-slate-200 truncate max-w-[150px]">
                  {acc.name}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  {acc.provider} • RPM: {acc.quota.rpmCurrent}
                </div>
              </div>

              <button
                onClick={() => onTriggerCooldown(acc.id)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-amber-950/50 text-amber-400 border border-amber-500/20 text-xs font-medium transition-colors cursor-pointer"
              >
                Gây 429
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
