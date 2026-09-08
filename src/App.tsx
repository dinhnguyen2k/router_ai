/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { AccountTable } from './components/AccountTable';
import { QuotaCharts } from './components/QuotaCharts';
import { RotationView } from './components/RotationView';
import { LogsView } from './components/LogsView';
import { AccountDetailModal } from './components/AccountDetailModal';
import { AddAccountModal } from './components/AddAccountModal';
import { api } from './api/client';
import {
  useAccounts,
  useLogs,
  useMetrics,
  useProviderUsage,
  useStaticConfig,
  useStatus,
  useTimeline
} from './hooks/useRouterData';
import { formatTokens } from './types';
import type { CreateAccountInput, SelectionStrategy } from '../shared/types';
import {
  CheckCircle2,
  Zap,
  Hourglass,
  AlertCircle,
  Activity
} from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function App() {
  const [activeTab, setActiveTab] = useState<string>('accounts');
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  const accountsState = useAccounts();
  const statusState = useStatus();
  const metricsState = useMetrics(DAY_MS);
  const timelineState = useTimeline(DAY_MS, 24);
  const providerUsageState = useProviderUsage(DAY_MS);
  const logsState = useLogs({ limit: 150 }, activeTab === 'logs');
  const { providers, connection } = useStaticConfig();

  const accounts = accountsState.data;
  const status = statusState.data;
  // A failed status poll is the clearest signal the router process is gone; the
  // account poll can also fail, but status is the lightest request we make.
  const routerOnline = statusState.error === null && !statusState.loading;

  const showToast = useCallback((message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  /** Runs a mutation, refreshes the affected views, and reports the outcome. */
  const mutate = useCallback(
    async (action: () => Promise<unknown>, successMessage: string) => {
      try {
        await action();
        accountsState.refresh();
        statusState.refresh();
        showToast(successMessage);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Thao tác thất bại');
      }
    },
    [accountsState, statusState, showToast],
  );

  const selectedAccount = accounts.find(a => a.id === selectedAccountId) ?? null;

  const heldAccounts = accounts.filter(
    a => a.status === 'cooldown' || a.status === 'temp_error' || a.status === 'quota_exceeded'
  );
  const activeCount = accounts.filter(a => a.status === 'active' || a.status === 'in_use').length;
  const servingAccount =
    accounts.find(a => a.id === status?.servingAccountId) ??
    accounts.find(a => a.status === 'in_use') ??
    accounts.find(a => a.status === 'active');

  const todayTokens = accounts.reduce((sum, a) => sum + a.quota.todayTokens, 0);
  const totalBudget = accounts.reduce((sum, a) => sum + a.quota.dailyTokenBudget, 0);
  const budgetPercent = totalBudget > 0 ? Math.min(100, Math.round((todayTokens / totalBudget) * 100)) : null;

  const handleAddAccount = async (input: CreateAccountInput) => {
    await api.createAccount(input);
    accountsState.refresh();
    showToast(`Đã thêm tài khoản: ${input.name || input.provider}`);
  };

  const handleCopyEndpoint = () => {
    if (connection === null) return;
    const snippet = [
      `# Antigravity CLI — ~/.gemini/antigravity-cli/settings.json`,
      `#   { "modelProvider": "gemini" }`,
      `export GOOGLE_GEMINI_BASE_URL=${connection.baseUrl}`,
      `export GEMINI_API_KEY=${connection.token}`,
      ``,
      `# Client OpenAI-compatible`,
      `#   base URL: ${connection.openaiBaseUrl}`,
      `#   api key : ${connection.token}`
    ].join('\n');
    void navigator.clipboard.writeText(snippet);
    showToast('Đã sao chép cấu hình kết nối');
  };

  const handleCopy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value);
    showToast(`Đã sao chép ${label}`);
  };

  return (
    <div className="flex min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 px-3.5 py-2 rounded-md bg-slate-900 text-white text-xs font-medium shadow-lg flex items-center gap-2 border border-slate-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{notification}</span>
        </div>
      )}

      {/* Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpenMobile={isMobileSidebarOpen}
        setIsOpenMobile={setIsMobileSidebarOpen}
        activeCount={activeCount}
        cooldownCount={heldAccounts.length}
        totalCount={accounts.length}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        routerOnline={routerOnline}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Navbar */}
        <Navbar
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onCopyEndpoint={handleCopyEndpoint}
          activeAccountName={servingAccount?.name}
          endpoint={connection?.baseUrl}
        />

        {/* Page Content Container */}
        <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
          {/* Router unreachable banner */}
          {statusState.error !== null && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="text-xs font-semibold text-rose-900">Không kết nối được Router</h4>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  {statusState.error} — chạy <code className="font-mono">npm start</code> để khởi động router.
                </p>
              </div>
            </div>
          )}

          {/* Main Account Pool & Status View */}
          {activeTab === 'accounts' && (
            <>
              {/* 3 Clear Top KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Serving Account */}
                <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium">Tài khoản phục vụ hiện tại</span>
                    <span className="p-1 rounded-md bg-slate-100 text-slate-700">
                      <Zap className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <div className="my-2">
                    <div className="font-semibold text-slate-900 text-sm truncate">
                      {servingAccount ? servingAccount.name : 'Chưa có'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${servingAccount ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      {servingAccount
                        ? `${servingAccount.providerLabel} • ${servingAccount.modelSummary}`
                        : 'Thêm API key để bắt đầu'}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Đang chạy:</span>
                    <span className="text-xs font-medium text-slate-700 flex items-center gap-1 font-mono">
                      <Activity className="h-3 w-3 text-slate-500" />
                      {status?.inFlight ?? 0} request
                    </span>
                  </div>
                </div>

                {/* Pool Status */}
                <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium">Trạng thái Account Pool</span>
                    <span className="p-1 rounded-md bg-slate-100 text-slate-700">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <div className="my-2 flex items-baseline gap-2">
                    <div className="text-2xl font-bold font-mono text-slate-900">
                      {activeCount}
                    </div>
                    <span className="text-xs text-slate-500 font-mono">
                      / {accounts.length} sẵn sàng
                    </span>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    {heldAccounts.length > 0 ? (
                      <span className="text-amber-700 flex items-center gap-1 font-medium">
                        <Hourglass className="h-3 w-3 text-amber-600" />
                        {heldAccounts.length} tài khoản đang chờ
                      </span>
                    ) : (
                      <span className="text-slate-500">
                        {accounts.length === 0 ? 'Pool đang trống' : 'Toàn bộ pool khả dụng'}
                      </span>
                    )}

                    {heldAccounts.length > 0 && (
                      <button
                        onClick={() => void mutate(() => api.clearAllCooldowns(), 'Đã gỡ toàn bộ cooldown')}
                        className="text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
                      >
                        Gỡ tất cả
                      </button>
                    )}
                  </div>
                </div>

                {/* Token usage today */}
                <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium">Token dùng hôm nay</span>
                    <span className="text-xs font-mono font-semibold text-slate-700">
                      {budgetPercent === null ? '—' : `${budgetPercent}%`}
                    </span>
                  </div>

                  <div className="my-2">
                    <div className="text-sm font-bold font-mono text-slate-900">
                      {formatTokens(todayTokens)}
                      {totalBudget > 0 && (
                        <span className="text-xs font-normal text-slate-500"> / {formatTokens(totalBudget)}</span>
                      )}
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div
                        className="bg-slate-800 h-full rounded-full transition-all duration-300"
                        style={{ width: `${budgetPercent ?? 0}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>
                      {metricsState.data?.totalRequests ?? 0} request / 24h
                    </span>
                    <button
                      onClick={() => setActiveTab('quota')}
                      className="text-slate-700 hover:text-slate-900 font-medium cursor-pointer"
                    >
                      Xem biểu đồ →
                    </button>
                  </div>
                </div>
              </div>

              {/* Account Table */}
              <AccountTable
                accounts={accounts}
                onSelectAccount={(account) => setSelectedAccountId(account.id)}
                onTriggerCooldown={(id) =>
                  void mutate(
                    () => api.forceCooldown(id, 120_000, 'Tạm rút khỏi pool thủ công'),
                    'Đã tạm rút tài khoản khỏi pool 120s',
                  )
                }
                onClearCooldown={(id) =>
                  void mutate(() => api.clearCooldown(id), 'Đã gỡ cooldown, tài khoản sẵn sàng')
                }
                onMakeActive={(id) =>
                  void mutate(() => api.updateAccount(id, { enabled: true }), 'Đã bật lại tài khoản')
                }
              />
            </>
          )}

          {/* Metrics View */}
          {activeTab === 'quota' && (
            <QuotaCharts
              accounts={accounts}
              metrics={metricsState.data}
              timeline={timelineState.data}
              providerUsage={providerUsageState.data}
            />
          )}

          {/* Rotation & Cooldown View */}
          {activeTab === 'rotation' && (
            <RotationView
              accounts={accounts}
              strategy={status?.strategy ?? 'round_robin'}
              onSelectStrategy={(strategy: SelectionStrategy) =>
                void mutate(
                  () => api.updateSettings({ strategy }),
                  'Đã đổi thuật toán định tuyến',
                )
              }
              onClearCooldown={(id) =>
                void mutate(() => api.clearCooldown(id), 'Đã gỡ cooldown')
              }
              onClearAllCooldowns={() =>
                void mutate(() => api.clearAllCooldowns(), 'Đã gỡ toàn bộ cooldown')
              }
              connection={connection}
              onCopy={handleCopy}
            />
          )}

          {/* Request Logs */}
          {activeTab === 'logs' && (
            <LogsView logs={logsState.data} loading={logsState.loading} />
          )}
        </main>
      </div>

      {/* Account Detail Modal */}
      {selectedAccount && (
        <AccountDetailModal
          account={selectedAccount}
          onClose={() => setSelectedAccountId(null)}
          onClearCooldown={(id) =>
            void mutate(() => api.clearCooldown(id), 'Đã gỡ cooldown')
          }
          onTriggerCooldown={(id) =>
            void mutate(
              () => api.forceCooldown(id, 120_000, 'Tạm rút khỏi pool thủ công'),
              'Đã tạm rút tài khoản khỏi pool',
            )
          }
          onToggleEnabled={(id, enabled) =>
            void mutate(
              () => api.updateAccount(id, { enabled }),
              enabled ? 'Đã bật lại tài khoản' : 'Đã tắt tài khoản',
            )
          }
          onDelete={(id) =>
            void mutate(() => api.deleteAccount(id), 'Đã xóa tài khoản khỏi pool')
          }
        />
      )}

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddAccount={handleAddAccount}
        providers={providers}
      />
    </div>
  );
}
