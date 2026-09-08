import React from 'react';
import { 
  RotateCw, 
  ArrowRight, 
  Hourglass, 
  Sparkles, 
  ShieldAlert, 
  CheckCircle, 
  Shuffle, 
  Activity,
  Zap,
  Clock
} from 'lucide-react';
import { AIAccount, RotationStrategy } from '../types';

interface RotationEngineCardProps {
  currentStrategy: RotationStrategy;
  onSelectStrategy: (strat: RotationStrategy) => void;
  activeAccount?: AIAccount;
  queueAccounts: AIAccount[];
  cooldownAccounts: AIAccount[];
  onForceRotate: () => void;
  onSimulateRateLimit: () => void;
  onResetAllCooldowns: () => void;
}

export const RotationEngineCard: React.FC<RotationEngineCardProps> = ({
  currentStrategy,
  onSelectStrategy,
  activeAccount,
  queueAccounts,
  cooldownAccounts,
  onForceRotate,
  onSimulateRateLimit,
  onResetAllCooldowns
}) => {
  const strategyOptions: { id: RotationStrategy; label: string; desc: string }[] = [
    { 
      id: 'round_robin', 
      label: 'Round Robin', 
      desc: 'Luân phiên đều từng tài khoản theo vòng tròn' 
    },
    { 
      id: 'least_used', 
      label: 'Cân bằng Quota (Least Used)', 
      desc: 'Tự động chọn tài khoản còn nhiều hạn mức token nhất' 
    },
    { 
      id: 'weighted_priority', 
      label: 'Trọng số ưu tiên (Weighted)', 
      desc: 'Phân bổ request dựa trên cấu hình Weight & Priority' 
    },
    { 
      id: 'failover_cascade', 
      label: 'Dự phòng thác đổ (Failover)', 
      desc: 'Dùng tài khoản chính, chỉ nhảy khi gặp 429/500 lỗi' 
    }
  ];

  return (
    <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800/90 shadow-xl shadow-black/20 space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400">
              <RotateCw className="h-4.5 w-4.5 animate-spin-slow" />
            </span>
            <h3 className="text-base font-bold text-slate-100">
              Bộ Điều Phối Xoay Vòng & Hồi Chiêu (Rotation Pipeline)
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Theo dõi luồng định tuyến request thời gian thực, thứ tự hàng đợi và trạng thái cooldown
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            id="btn-force-rotate"
            onClick={onForceRotate}
            className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Xoay Vòng Tiếp Theo
          </button>

          <button
            id="btn-simulate-rate-limit"
            onClick={onSimulateRateLimit}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-amber-950/40 text-amber-300 hover:text-amber-200 border border-amber-500/30 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Giả lập tài khoản đang chạy bị 429 để kiểm tra cơ chế nhảy tự động"
          >
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
            Test 429 Cooldown
          </button>

          {cooldownAccounts.length > 0 && (
            <button
              id="btn-reset-cooldowns"
              onClick={onResetAllCooldowns}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-emerald-950/40 text-emerald-300 hover:text-emerald-200 border border-emerald-500/30 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              Reset Cooldown ({cooldownAccounts.length})
            </button>
          )}
        </div>
      </div>

      {/* Visual Live Rotation Pipeline Ribbon */}
      <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80">
        <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center justify-between">
          <span>Tiến trình định tuyến thời gian thực</span>
          <span className="text-emerald-400 font-mono lowercase flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            live traffic routing
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* Active Serving Node */}
          <div className="md:col-span-4 p-3.5 rounded-xl bg-indigo-950/30 border-2 border-indigo-500/50 shadow-lg shadow-indigo-950/50 relative overflow-hidden">
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500 text-white tracking-wide uppercase">
                <Activity className="h-2.5 w-2.5 animate-pulse" /> Đang Phục Vụ
              </span>
            </div>

            <div className="text-[11px] text-indigo-300 font-medium">Slot Active Hiện Tại</div>
            <div className="font-bold text-slate-100 text-sm mt-0.5 truncate pr-20">
              {activeAccount?.name || 'Chưa chọn'}
            </div>
            
            <div className="mt-2.5 pt-2 border-t border-indigo-500/20 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-mono text-[11px]">{activeAccount?.provider}</span>
              <span className="text-emerald-400 font-mono font-medium">
                {Math.round(((activeAccount?.quota.totalTokens || 1) - (activeAccount?.quota.usedTokens || 0)) / 1_000_000)}M tokens rảnh
              </span>
            </div>
          </div>

          {/* Flow Indicator */}
          <div className="hidden md:flex md:col-span-1 justify-center text-slate-500">
            <ArrowRight className="h-5 w-5 text-indigo-400" />
          </div>

          {/* Next in Queue (2 slots) */}
          <div className="md:col-span-4 flex flex-col gap-2">
            <div className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
              <Clock className="h-3 w-3 text-slate-400" /> Kế tiếp trong hàng đợi xoay vòng:
            </div>
            <div className="grid grid-cols-2 gap-2">
              {queueAccounts.slice(0, 2).map((acc, idx) => (
                <div key={acc.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono text-slate-400">#{idx + 1} Hàng đợi</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </div>
                  <div className="text-xs font-semibold text-slate-200 truncate mt-1">
                    {acc.name}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-1">
                    Trọng số: {acc.weight}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cooldown Bin (Rate Limited) */}
          <div className="md:col-span-3 p-3 rounded-xl bg-amber-950/20 border border-amber-500/20 flex flex-col justify-between h-full min-h-[90px]">
            <div className="flex items-center justify-between text-[11px] text-amber-400">
              <span className="flex items-center gap-1 font-semibold">
                <Hourglass className="h-3.5 w-3.5" /> Hồi Chiêu (Cooldown)
              </span>
              <span className="font-mono">{cooldownAccounts.length} slot</span>
            </div>

            {cooldownAccounts.length > 0 ? (
              <div className="mt-1 space-y-1">
                {cooldownAccounts.slice(0, 2).map(ca => (
                  <div key={ca.id} className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-300 truncate max-w-[110px] text-[11px]">{ca.name}</span>
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">
                      {ca.cooldown.remainingSeconds}s còn
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic py-1">
                Không có tài khoản nào bị rate-limit
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Algorithm Selection Segment */}
      <div>
        <div className="text-xs font-semibold text-slate-400 mb-2.5">
          Lựa chọn thuật toán xoay vòng (Rotation Strategy):
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {strategyOptions.map(opt => {
            const isSelected = currentStrategy === opt.id;
            return (
              <button
                key={opt.id}
                id={`strategy-btn-${opt.id}`}
                onClick={() => onSelectStrategy(opt.id)}
                className={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                  isSelected 
                    ? 'bg-indigo-950/50 border-indigo-500/70 shadow-sm ring-1 ring-indigo-500/50' 
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${isSelected ? 'text-indigo-300' : 'text-slate-200'}`}>
                    {opt.label}
                  </span>
                  {isSelected && <Zap className="h-3.5 w-3.5 text-indigo-400" />}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {opt.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
