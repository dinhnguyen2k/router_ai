/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { AccountTable } from './components/AccountTable';
import { QuotaCharts } from './components/QuotaCharts';
import { RotationView } from './components/RotationView';
import { AccountDetailModal } from './components/AccountDetailModal';
import { AddAccountModal } from './components/AddAccountModal';
import { INITIAL_ACCOUNTS } from './mockData';
import { AIAccount, RotationStrategy } from './types';
import { 
  CheckCircle2, 
  Zap, 
  RotateCw, 
  Hourglass
} from 'lucide-react';

export default function App() {
  const [accounts, setAccounts] = useState<AIAccount[]>(INITIAL_ACCOUNTS);
  const [activeTab, setActiveTab] = useState<string>('accounts');
  const [strategy, setStrategy] = useState<RotationStrategy>('round_robin');
  const [selectedAccount, setSelectedAccount] = useState<AIAccount | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Toast notification helper
  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => {
      setNotification(null);
    }, 3000);
  };

  // Cooldown countdown timer interval (ticks every second)
  useEffect(() => {
    const timer = setInterval(() => {
      setAccounts(prevAccounts => 
        prevAccounts.map(acc => {
          if ((acc.status === 'cooldown' || acc.cooldown.isInCooldown) && acc.cooldown.remainingSeconds > 0) {
            const newRemaining = acc.cooldown.remainingSeconds - 1;
            if (newRemaining <= 0) {
              return {
                ...acc,
                status: 'active',
                cooldown: {
                  ...acc.cooldown,
                  isInCooldown: false,
                  remainingSeconds: 0,
                  reason: 'Đã hoàn tất hồi chiêu',
                  triggerTimestamp: 'Vừa xong'
                }
              };
            }
            return {
              ...acc,
              cooldown: {
                ...acc.cooldown,
                remainingSeconds: newRemaining
              }
            };
          }
          return acc;
        })
      );
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Filter calculations
  const activeServingAccount = accounts.find(a => a.status === 'in_use') || accounts.find(a => a.status === 'active');
  const readyAccounts = accounts.filter(a => a.status === 'active');
  const cooldownAccounts = accounts.filter(a => a.status === 'cooldown' || a.cooldown.isInCooldown);
  const activeCount = accounts.filter(a => a.status === 'active' || a.status === 'in_use').length;

  const totalUsedTokens = accounts.reduce((sum, a) => sum + a.quota.usedTokens, 0);
  const totalLimitTokens = accounts.reduce((sum, a) => sum + a.quota.totalTokens, 0);
  const usagePercent = Math.round((totalUsedTokens / totalLimitTokens) * 100);

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return val.toString();
  };

  // Quick Rotate to next ready account
  const handleForceRotate = () => {
    const candidateAccounts = accounts.filter(a => a.status === 'active' || a.status === 'in_use');
    if (candidateAccounts.length <= 1) {
      showToast('Cần ít nhất 2 tài khoản sẵn sàng để xoay vòng!');
      return;
    }

    const currentActiveIndex = accounts.findIndex(a => a.status === 'in_use');
    let nextIndex = -1;

    if (currentActiveIndex === -1) {
      nextIndex = accounts.findIndex(a => a.status === 'active');
    } else {
      for (let i = 1; i <= accounts.length; i++) {
        const candidateIdx = (currentActiveIndex + i) % accounts.length;
        if (accounts[candidateIdx].status === 'active') {
          nextIndex = candidateIdx;
          break;
        }
      }
    }

    if (nextIndex !== -1) {
      const nextAcc = accounts[nextIndex];
      setAccounts(prev => prev.map((acc, idx) => {
        if (idx === nextIndex) {
          return { ...acc, status: 'in_use', lastUsedAt: 'Vừa xong' };
        }
        if (acc.status === 'in_use') {
          return { ...acc, status: 'active' };
        }
        return acc;
      }));

      showToast(`Đã xoay vòng sang: ${nextAcc.name}`);
    }
  };

  // Trigger Cooldown manually
  const handleTriggerCooldown = (accountId: string) => {
    const targeted = accounts.find(a => a.id === accountId);
    setAccounts(prev => prev.map(acc => {
      if (acc.id === accountId) {
        return {
          ...acc,
          status: 'cooldown',
          cooldown: {
            isInCooldown: true,
            remainingSeconds: 120,
            totalDurationSeconds: 120,
            reason: 'Rate limit 429 (Chạm trần RPM)',
            triggerTimestamp: 'Vừa kích hoạt'
          }
        };
      }
      return acc;
    }));

    // If active serving account entered cooldown, auto rotate
    if (targeted?.status === 'in_use') {
      setTimeout(() => handleForceRotate(), 100);
    }

    showToast(`Đã đưa ${targeted?.name || 'tài khoản'} vào Cooldown 120s`);
  };

  // Clear Cooldown manually
  const handleClearCooldown = (accountId: string) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === accountId) {
        return {
          ...acc,
          status: 'active',
          cooldown: {
            isInCooldown: false,
            remainingSeconds: 0,
            totalDurationSeconds: 120,
            reason: 'Đã gỡ cooldown thủ công',
            triggerTimestamp: 'Vừa xong'
          }
        };
      }
      return acc;
    }));

    showToast('Đã gỡ Cooldown, tài khoản sẵn sàng');
  };

  // Clear All Cooldowns
  const handleClearAllCooldowns = () => {
    setAccounts(prev => prev.map(acc => {
      if (acc.status === 'cooldown' || acc.cooldown.isInCooldown) {
        return {
          ...acc,
          status: 'active',
          cooldown: {
            isInCooldown: false,
            remainingSeconds: 0,
            totalDurationSeconds: 120,
            reason: 'Đã gỡ toàn bộ cooldown',
            triggerTimestamp: 'Vừa xong'
          }
        };
      }
      return acc;
    }));

    showToast('Đã gỡ bỏ toàn bộ cooldown trong Pool');
  };

  // Set as Active Serving
  const handleMakeActive = (accountId: string) => {
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return;

    setAccounts(prev => prev.map(a => {
      if (a.id === accountId) {
        return { ...a, status: 'in_use', lastUsedAt: 'Vừa xong' };
      }
      if (a.status === 'in_use') {
        return { ...a, status: 'active' };
      }
      return a;
    }));

    showToast(`Đã chuyển sang dùng ${acc.name}`);
  };

  // Reset Quota
  const handleResetQuota = (accountId: string) => {
    setAccounts(prev => prev.map(a => {
      if (a.id === accountId) {
        return {
          ...a,
          quota: {
            ...a.quota,
            usedTokens: 0,
            dailySpentUsd: 0,
            rpmCurrent: 0,
            tpmCurrent: 0
          }
        };
      }
      return a;
    }));

    showToast('Đã làm mới hạn mức Token');
  };

  // Add new account
  const handleAddAccount = (newAcc: AIAccount) => {
    setAccounts(prev => [newAcc, ...prev]);
    showToast(`Đã thêm tài khoản: ${newAcc.name}`);
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
        cooldownCount={cooldownAccounts.length}
        totalCount={accounts.length}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onQuickRotate={handleForceRotate}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Navbar */}
        <Navbar
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          onOpenAddModal={() => setIsAddModalOpen(true)}
          onQuickRotate={handleForceRotate}
          activeAccountName={activeServingAccount?.name}
          activeCount={activeCount}
          totalCount={accounts.length}
        />

        {/* Page Content Container */}
        <main className="flex-1 p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-5">
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
                      {activeServingAccount ? activeServingAccount.name : 'Chưa chọn'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {activeServingAccount ? `${activeServingAccount.provider} • ${activeServingAccount.modelTier}` : 'Không có'}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">Chuyển slot:</span>
                    <button
                      onClick={handleForceRotate}
                      className="text-xs font-medium text-slate-700 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCw className="h-3 w-3 text-slate-500" />
                      Xoay vòng ngay
                    </button>
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
                    {cooldownAccounts.length > 0 ? (
                      <span className="text-amber-700 flex items-center gap-1 font-medium">
                        <Hourglass className="h-3 w-3 text-amber-600" />
                        {cooldownAccounts.length} tài khoản đang hồi chiêu
                      </span>
                    ) : (
                      <span className="text-slate-500">100% tài khoản hoạt động tốt</span>
                    )}

                    {cooldownAccounts.length > 0 && (
                      <button
                        onClick={handleClearAllCooldowns}
                        className="text-xs text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
                      >
                        Gỡ tất cả
                      </button>
                    )}
                  </div>
                </div>

                {/* Quota Usage */}
                <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-xs flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-medium">Tổng hạn mức Token</span>
                    <span className="text-xs font-mono font-semibold text-slate-700">
                      {usagePercent}%
                    </span>
                  </div>

                  <div className="my-2">
                    <div className="text-sm font-bold font-mono text-slate-900">
                      {formatTokens(totalUsedTokens)} <span className="text-xs font-normal text-slate-500">/ {formatTokens(totalLimitTokens)}</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2 overflow-hidden">
                      <div 
                        className="bg-slate-800 h-full rounded-full transition-all duration-300"
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Còn lại: <strong className="text-slate-700 font-mono">{formatTokens(totalLimitTokens - totalUsedTokens)}</strong></span>
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
                onSelectAccount={setSelectedAccount}
                onToggleStatus={(id) => {
                  const target = accounts.find(a => a.id === id);
                  if (target?.status === 'cooldown' || target?.cooldown.isInCooldown) {
                    handleClearCooldown(id);
                  } else {
                    handleTriggerCooldown(id);
                  }
                }}
                onTriggerCooldown={handleTriggerCooldown}
                onClearCooldown={handleClearCooldown}
                onMakeActive={handleMakeActive}
              />
            </>
          )}

          {/* Quota Charts View */}
          {activeTab === 'quota' && (
            <QuotaCharts accounts={accounts} />
          )}

          {/* Rotation & Cooldown View */}
          {activeTab === 'rotation' && (
            <RotationView
              accounts={accounts}
              strategy={strategy}
              onSelectStrategy={setStrategy}
              onForceRotate={handleForceRotate}
              onClearCooldown={handleClearCooldown}
              onClearAllCooldowns={handleClearAllCooldowns}
              onTriggerCooldown={handleTriggerCooldown}
            />
          )}
        </main>
      </div>

      {/* Account Detail Modal */}
      {selectedAccount && (
        <AccountDetailModal
          account={selectedAccount}
          onClose={() => setSelectedAccount(null)}
          onClearCooldown={handleClearCooldown}
          onTriggerCooldown={handleTriggerCooldown}
          onMakeActive={handleMakeActive}
          onResetQuota={handleResetQuota}
        />
      )}

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddAccount={handleAddAccount}
      />
    </div>
  );
}
