import React from 'react';
import { 
  RefreshCw, 
  Hourglass, 
  CheckCircle2, 
  Zap, 
  Shuffle, 
  ShieldAlert
} from 'lucide-react';
import { AIAccount, RotationStrategy } from '../types';

interface RotationViewProps {
  accounts: AIAccount[];
  strategy: RotationStrategy;
  onSelectStrategy: (strat: RotationStrategy) => void;
  onForceRotate: () => void;
  onClearCooldown: (id: string) => void;
  onClearAllCooldowns: () => void;
  onTriggerCooldown: (id: string) => void;
}

export const RotationView: React.FC<RotationViewProps> = ({
  accounts,
  strategy,
  onSelectStrategy,
  onForceRotate,
  onClearCooldown,
  onClearAllCooldowns,
  onTriggerCooldown
}) => {
  const activeServing = accounts.find(a => a.status === 'in_use') || accounts.find(a => a.status === 'active');
  const queueAccounts = accounts.filter(a => a.status === 'active');
  const cooldownAccounts = accounts.filter(a => a.status === 'cooldown' || a.cooldown.isInCooldown);

  const strategies: { id: RotationStrategy; title: string; desc: string }[] = [
    { 
      id: 'round_robin', 
      title: 'Round Robin', 
      desc: 'Luân phiên tuần tự từng tài khoản theo vòng lặp' 
    },
    { 
      id: 'least_used', 
      title: 'Cân bằng Quota (Least Used)', 
      desc: 'Ưu tiên tài khoản còn nhiều hạn mức Token nhất' 
    },
    { 
      id: 'weighted_priority', 
      title: 'Trọng số ưu tiên (Priority)', 
      desc: 'Phân phối theo cấu hình Priority và Trọng số (Weight)' 
    }
  ];

  return (
    <div className="space-y-5">
      {/* Top Banner with Action Buttons */}
      <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-slate-600" />
            Điều phối xoay vòng & Hồi chiêu
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Quản lý tự động chuyển tiếp request và xử lý an toàn khi gặp Rate Limit (429)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-rotation-rotate-now"
            onClick={onForceRotate}
            className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Shuffle className="h-3.5 w-3.5" />
            Xoay Vòng Tiếp Theo
          </button>

          {activeServing && (
            <button
              id="btn-rotation-simulate-429"
              onClick={() => onTriggerCooldown(activeServing.id)}
              className="px-3 py-1.5 rounded-md bg-white hover:bg-amber-50 text-amber-800 border border-amber-200 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Giả lập tài khoản gặp 429 để tự động chuyển sang tài khoản kế tiếp"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              Thử Lỗi 429
            </button>
          )}
        </div>
      </div>

      {/* Strategy Selector */}
      <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          Thuật toán xoay vòng (Strategy)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          {strategies.map(s => {
            const isSelected = strategy === s.id;
            return (
              <button
                key={s.id}
                id={`btn-strategy-${s.id}`}
                onClick={() => onSelectStrategy(s.id)}
                className={`p-3 rounded-md text-left border transition-colors cursor-pointer ${
                  isSelected 
                    ? 'border-slate-900 bg-slate-50 text-slate-900 font-medium' 
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                    {s.title}
                  </span>
                  {isSelected && (
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  {s.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 Columns: Pipeline Flow & Cooldowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pipeline Queue */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
              Hàng đợi xoay vòng (Queue)
            </h4>
            <span className="text-xs text-slate-500 font-mono">
              {queueAccounts.length + (activeServing ? 1 : 0)} sẵn sàng
            </span>
          </div>

          <div className="space-y-2">
            {/* Active Serving Card */}
            {activeServing && (
              <div className="p-3 rounded-md bg-blue-50/50 border border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-blue-100 text-blue-700">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                      {activeServing.name}
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white text-slate-600 border border-slate-200">
                        {activeServing.provider}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Đang nhận traffic ({activeServing.modelTier})
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  Active
                </span>
              </div>
            )}

            {/* Next in Line Accounts */}
            {queueAccounts.slice(0, 4).map((acc, index) => (
              <div 
                key={acc.id}
                className="p-2.5 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-4 h-4 rounded bg-slate-200 text-slate-600 font-mono text-[10px] flex items-center justify-center font-bold">
                    {index + 1}
                  </span>
                  <div>
                    <div className="font-medium text-slate-800">{acc.name}</div>
                    <div className="text-[10px] text-slate-500">{acc.provider} • {acc.modelTier}</div>
                  </div>
                </div>
                <span className="text-[11px] font-mono text-emerald-700">
                  {Math.round(((acc.quota.totalTokens - acc.quota.usedTokens) / 1_000_000))}M tokens còn
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Cooldown Accounts List */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-2">
              <Hourglass className="h-3.5 w-3.5 text-amber-600" />
              Tài khoản đang hồi chiêu (Cooldown)
            </h4>

            {cooldownAccounts.length > 0 && (
              <button
                onClick={onClearAllCooldowns}
                className="text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                Gỡ tất cả ({cooldownAccounts.length})
              </button>
            )}
          </div>

          {cooldownAccounts.length === 0 ? (
            <div className="p-6 rounded-md bg-slate-50 border border-slate-200 text-center space-y-1.5">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
              <div className="text-xs font-semibold text-slate-800">
                Không có tài khoản nào bị Cooldown
              </div>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                Tất cả tài khoản trong Pool đều hoạt động bình thường, không chạm ngưỡng 429.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {cooldownAccounts.map(acc => (
                <div 
                  key={acc.id}
                  className="p-2.5 rounded-md bg-amber-50/60 border border-amber-200 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Hourglass className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 truncate">
                        {acc.name}
                      </div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {acc.cooldown.reason}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-xs font-mono font-medium text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-200">
                      {acc.cooldown.remainingSeconds}s
                    </div>
                    <button
                      onClick={() => onClearCooldown(acc.id)}
                      className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Gỡ ngay
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
