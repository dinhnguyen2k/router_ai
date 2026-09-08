import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
  ChevronRight,
  ScrollText
} from 'lucide-react';
import {
  ERROR_CLASS_LABELS,
  OUTCOME_LABELS,
  formatClock,
  formatDuration
} from '../types';
import type { RequestLogDto, RequestOutcome } from '../../shared/types';

interface LogsViewProps {
  logs: RequestLogDto[];
  loading: boolean;
}

const OUTCOME_STYLES: Record<RequestOutcome, { badge: string; Icon: typeof CheckCircle2 }> = {
  success: {
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Icon: CheckCircle2
  },
  failed: {
    badge: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: XCircle
  },
  partial_failure: {
    badge: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: AlertTriangle
  },
  cancelled: {
    badge: 'bg-slate-100 text-slate-600 border-slate-200',
    Icon: Ban
  }
};

export const LogsView: React.FC<LogsViewProps> = ({ logs, loading }) => {
  const [filter, setFilter] = useState<'all' | RequestOutcome>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = filter === 'all' ? logs : logs.filter(entry => entry.outcome === filter);

  const tabs: Array<{ id: 'all' | RequestOutcome; label: string }> = [
    { id: 'all', label: 'Tất cả' },
    { id: 'success', label: 'Thành công' },
    { id: 'failed', label: 'Thất bại' },
    { id: 'partial_failure', label: 'Đứt stream' },
    { id: 'cancelled', label: 'Đã hủy' }
  ];

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-slate-600" />
          Nhật ký request
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Mỗi dòng là một request đi qua router. Bấm để xem từng lần thử tài khoản.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        {/* Filter tabs */}
        <div className="p-3.5 border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
          {tabs.map(tab => {
            const count = tab.id === 'all' ? logs.length : logs.filter(l => l.outcome === tab.id).length;
            return (
              <button
                key={tab.id}
                id={`tab-log-${tab.id}`}
                onClick={() => setFilter(tab.id)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0 flex items-center gap-1.5 ${
                  filter === tab.id
                    ? 'bg-slate-900 text-white font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
                <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                  filter === tab.id ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-4">Thời điểm</th>
                <th className="py-2.5 px-4">Model</th>
                <th className="py-2.5 px-4">Kết quả</th>
                <th className="py-2.5 px-4">Tài khoản</th>
                <th className="py-2.5 px-4 hidden md:table-cell">Độ trễ</th>
                <th className="py-2.5 px-4 text-right">Lần thử</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    {loading ? 'Đang tải...' : 'Chưa có request nào đi qua router.'}
                  </td>
                </tr>
              ) : (
                filtered.map(entry => {
                  const style = OUTCOME_STYLES[entry.outcome];
                  const isOpen = expanded === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => setExpanded(isOpen ? null : entry.id)}
                      >
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                          {formatClock(entry.createdAt)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-800">{entry.model}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {entry.protocol}{entry.stream ? ' • stream' : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium border ${style.badge}`}>
                            <style.Icon className="h-3 w-3" />
                            {OUTCOME_LABELS[entry.outcome]}
                          </span>
                          {entry.errorClass && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {ERROR_CLASS_LABELS[entry.errorClass]}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">
                          {entry.accountName ?? <span className="text-slate-400">—</span>}
                        </td>
                        <td className="py-2.5 px-4 hidden md:table-cell font-mono text-[11px] text-slate-600">
                          {formatDuration(entry.durationMs)}
                          {entry.ttfbMs !== null && (
                            <div className="text-[10px] text-slate-400">
                              TTFB {formatDuration(entry.ttfbMs)}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <span className={`font-mono text-[11px] ${entry.attemptCount > 1 ? 'text-amber-600 font-semibold' : 'text-slate-500'}`}>
                            {entry.attemptCount}
                          </span>
                          <ChevronRight
                            className={`inline h-3 w-3 ml-1 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          />
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={6} className="px-4 py-3">
                            <div className="space-y-1.5">
                              {entry.errorMessage && (
                                <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
                                  {entry.errorMessage}
                                </div>
                              )}
                              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                                Các lần thử
                              </div>
                              {entry.attempts.map((attempt, index) => (
                                <div
                                  key={`${entry.id}-${index}`}
                                  className="flex items-center justify-between bg-white border border-slate-200 rounded px-2.5 py-1.5 text-[11px]"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-4 h-4 rounded bg-slate-200 text-slate-600 font-mono text-[10px] flex items-center justify-center font-bold shrink-0">
                                      {index + 1}
                                    </span>
                                    <span className="text-slate-800 font-medium truncate">
                                      {attempt.accountName ?? '—'}
                                    </span>
                                    {attempt.committed && (
                                      <span
                                        className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] shrink-0"
                                        title="Đã gửi dữ liệu xuống client — router không được phép chuyển tài khoản từ điểm này"
                                      >
                                        đã gửi dữ liệu
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    {attempt.errorMessage && (
                                      <span className="text-slate-500 truncate max-w-[220px] hidden sm:inline">
                                        {attempt.errorMessage}
                                      </span>
                                    )}
                                    {attempt.status !== null && (
                                      <span className={`font-mono ${attempt.status >= 400 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                        {attempt.status}
                                      </span>
                                    )}
                                    <span className="font-mono text-slate-400">
                                      {formatDuration(attempt.durationMs)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                              {(entry.promptTokens !== null || entry.completionTokens !== null) && (
                                <div className="text-[10px] text-slate-500 font-mono pt-1">
                                  Token: {entry.promptTokens ?? 0} vào / {entry.completionTokens ?? 0} ra
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
