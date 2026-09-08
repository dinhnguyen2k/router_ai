import React from 'react';
import {
  RefreshCw,
  Hourglass,
  CheckCircle2,
  Zap,
  AlertTriangle,
  Terminal,
  Copy
} from 'lucide-react';
import { AIAccount, STRATEGY_LABELS, formatTokens } from '../types';
import type { SelectionStrategy } from '../../shared/types';
import type { ConnectionInfo } from '../api/client';

interface RotationViewProps {
  accounts: AIAccount[];
  strategy: SelectionStrategy;
  onSelectStrategy: (strategy: SelectionStrategy) => void;
  onClearCooldown: (id: string) => void;
  onClearAllCooldowns: () => void;
  connection: ConnectionInfo | null;
  onCopy: (label: string, value: string) => void;
}

export const RotationView: React.FC<RotationViewProps> = ({
  accounts,
  strategy,
  onSelectStrategy,
  onClearCooldown,
  onClearAllCooldowns,
  connection,
  onCopy
}) => {
  const serving = accounts.find(a => a.status === 'in_use');
  const queueAccounts = accounts.filter(a => a.status === 'active');
  const heldAccounts = accounts.filter(
    a => a.status === 'cooldown' || a.status === 'temp_error' || a.status === 'quota_exceeded'
  );

  const strategies = Object.entries(STRATEGY_LABELS) as Array<
    [SelectionStrategy, { title: string; desc: string }]
  >;

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-slate-600" />
            Điều phối xoay vòng & Hồi chiêu
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Router tự chọn tài khoản theo thuật toán bên dưới, và tự chuyển khi gặp 429 / lỗi upstream
          </p>
        </div>

        {heldAccounts.length > 0 && (
          <button
            id="btn-rotation-clear-all"
            onClick={onClearAllCooldowns}
            className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Gỡ tất cả Cooldown ({heldAccounts.length})
          </button>
        )}
      </div>

      {/* Connection snippet */}
      {connection && (
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
          <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <Terminal className="h-3.5 w-3.5 text-slate-600" />
            Kết nối CLI vào Router
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-xs font-semibold text-slate-800">Antigravity CLI</div>
              <p className="text-[11px] text-slate-500">
                Đặt <code className="font-mono text-slate-700">{'{ "modelProvider": "gemini" }'}</code> trong{' '}
                <code className="font-mono text-slate-700">~/.gemini/antigravity-cli/settings.json</code>
              </p>
              <button
                onClick={() =>
                  onCopy(
                    'Lệnh Antigravity CLI',
                    `export GOOGLE_GEMINI_BASE_URL=${connection.baseUrl}\nexport GEMINI_API_KEY=${connection.token}`
                  )
                }
                className="w-full text-left font-mono text-[10px] bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-start justify-between gap-2"
              >
                <span className="break-all">
                  GOOGLE_GEMINI_BASE_URL={connection.baseUrl}
                  <br />
                  GEMINI_API_KEY={connection.token.slice(0, 12)}…
                </span>
                <Copy className="h-3 w-3 text-slate-400 shrink-0 mt-0.5" />
              </button>
            </div>

            <div className="p-3 rounded-md bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="text-xs font-semibold text-slate-800">Client OpenAI-compatible</div>
              <p className="text-[11px] text-slate-500">Cline, Roo Code, Continue, Aider…</p>
              <button
                onClick={() =>
                  onCopy('Base URL + key', `${connection.openaiBaseUrl}\n${connection.token}`)
                }
                className="w-full text-left font-mono text-[10px] bg-white border border-slate-200 rounded px-2 py-1.5 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer flex items-start justify-between gap-2"
              >
                <span className="break-all">
                  {connection.openaiBaseUrl}
                  <br />
                  {connection.token.slice(0, 12)}…
                </span>
                <Copy className="h-3 w-3 text-slate-400 shrink-0 mt-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Strategy Selector */}
      <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-2.5">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
          Thuật toán chọn tài khoản (Strategy)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {strategies.map(([id, meta]) => {
            const isSelected = strategy === id;
            return (
              <button
                key={id}
                id={`btn-strategy-${id}`}
                onClick={() => onSelectStrategy(id)}
                className={`p-3 rounded-md text-left border transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-slate-900 bg-slate-50 text-slate-900 font-medium'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                    {meta.title}
                  </span>
                  {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-slate-900" />}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{meta.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2 Columns: Queue & Cooldowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pipeline Queue */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
              Hàng đợi khả dụng
            </h4>
            <span className="text-xs text-slate-500 font-mono">
              {queueAccounts.length + (serving ? 1 : 0)} sẵn sàng
            </span>
          </div>

          <div className="space-y-2">
            {serving && (
              <div className="p-3 rounded-md bg-blue-50/50 border border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-blue-100 text-blue-700">
                    <Zap className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                      {serving.name}
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white text-slate-600 border border-slate-200">
                        {serving.providerLabel}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      {serving.inFlight} request đang chạy • {serving.modelSummary}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  Active
                </span>
              </div>
            )}

            {queueAccounts.length === 0 && !serving ? (
              <div className="p-6 rounded-md bg-slate-50 border border-slate-200 text-center space-y-1.5">
                <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
                <div className="text-xs font-semibold text-slate-800">
                  Không có tài khoản nào sẵn sàng
                </div>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                  Thêm API key, hoặc chờ các tài khoản đang cooldown hồi lại.
                </p>
              </div>
            ) : (
              queueAccounts.slice(0, 5).map((acc, index) => (
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
                      <div className="text-[10px] text-slate-500">
                        P{acc.priority} • trọng số {acc.weight} • {acc.modelSummary}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">
                    {formatTokens(acc.quota.todayTokens)} hôm nay
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Held Accounts */}
        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-2">
              <Hourglass className="h-3.5 w-3.5 text-amber-600" />
              Tài khoản đang bị giữ lại
            </h4>

            {heldAccounts.length > 0 && (
              <button
                onClick={onClearAllCooldowns}
                className="text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                Gỡ tất cả ({heldAccounts.length})
              </button>
            )}
          </div>

          {heldAccounts.length === 0 ? (
            <div className="p-6 rounded-md bg-slate-50 border border-slate-200 text-center space-y-1.5">
              <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
              <div className="text-xs font-semibold text-slate-800">
                Không có tài khoản nào bị giữ lại
              </div>
              <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                Toàn bộ pool đang khả dụng, chưa chạm giới hạn nào.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {heldAccounts.map(acc => (
                <div
                  key={acc.id}
                  className="p-2.5 rounded-md bg-amber-50/60 border border-amber-200 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {acc.status === 'temp_error' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    ) : (
                      <Hourglass className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 truncate">{acc.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {acc.status === 'quota_exceeded'
                          ? 'Hết hạn mức token ngày'
                          : acc.cooldown.reason || 'Đang chờ hồi'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {acc.cooldown.remainingSeconds > 0 && (
                      <div className="text-xs font-mono font-medium text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-200">
                        {acc.cooldown.remainingSeconds}s
                      </div>
                    )}
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
