import React from 'react';
import { 
  Layers, 
  BarChart3, 
  RefreshCw, 
  Plus, 
  Database,
  Hourglass
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpenMobile: boolean;
  setIsOpenMobile: (open: boolean) => void;
  activeCount: number;
  cooldownCount: number;
  totalCount: number;
  onOpenAddModal: () => void;
  onQuickRotate: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpenMobile,
  setIsOpenMobile,
  activeCount,
  cooldownCount,
  totalCount,
  onOpenAddModal,
  onQuickRotate
}) => {
  const navigationItems = [
    { 
      id: 'accounts', 
      label: 'Danh sách tài khoản', 
      icon: Layers, 
      count: totalCount 
    },
    { 
      id: 'quota', 
      label: 'Biểu đồ hạn mức', 
      icon: BarChart3,
      badge: 'Realtime'
    },
    { 
      id: 'rotation', 
      label: 'Xoay vòng & Cooldown', 
      icon: RefreshCw, 
      badge: cooldownCount > 0 ? `${cooldownCount} chờ` : undefined,
      badgeColor: 'bg-amber-50 text-amber-700 border border-amber-200'
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div 
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-xs z-40 lg:hidden"
          onClick={() => setIsOpenMobile(false)}
        />
      )}

      {/* Sidebar Container */}
      <aside 
        id="app-sidebar"
        className={`fixed lg:static top-0 left-0 bottom-0 w-60 bg-white border-r border-slate-200 flex flex-col z-50 transition-transform duration-200 ease-in-out ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Brand Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-md bg-slate-900 flex items-center justify-center text-white">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 text-xs tracking-tight">
                AI Account Pool
              </div>
              <p className="text-[11px] text-slate-500">Quản lý & Điều phối</p>
            </div>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex-1 px-2.5 py-3 space-y-1">
          <div className="px-2 pb-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Điều hướng
          </div>

          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-item-${item.id}`}
                onClick={() => {
                  setActiveTab(item.id);
                  setIsOpenMobile(false);
                }}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors text-left cursor-pointer ${
                  isActive 
                    ? 'bg-slate-100 text-slate-900 font-semibold' 
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-slate-900' : 'text-slate-500'}`} />
                  <div className="truncate">{item.label}</div>
                </div>

                {item.count !== undefined && (
                  <span className={`text-[11px] px-1.5 py-0.2 rounded font-mono ${
                    isActive ? 'bg-white text-slate-700 border border-slate-200' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {item.count}
                  </span>
                )}

                {item.badge && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-medium ${
                    item.badgeColor || (isActive ? 'bg-slate-200 text-slate-800' : 'bg-slate-100 text-slate-600')
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Status Card */}
        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 text-[11px]">Trạng thái pool:</span>
              <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {activeCount}/{totalCount} Sẵn sàng
              </span>
            </div>

            {cooldownCount > 0 && (
              <div className="flex items-center justify-between text-amber-700 text-[11px]">
                <span className="flex items-center gap-1">
                  <Hourglass className="h-3 w-3" />
                  Đang cooldown:
                </span>
                <span className="font-semibold font-mono">{cooldownCount} tài khoản</span>
              </div>
            )}

            <button
              id="btn-sidebar-quick-rotate"
              onClick={onQuickRotate}
              className="w-full py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="h-3 w-3 text-slate-500" />
              Xoay Vòng Tiếp Theo
            </button>
          </div>

          <button
            id="btn-sidebar-add-account"
            onClick={onOpenAddModal}
            className="w-full py-1.5 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Thêm Tài Khoản</span>
          </button>
        </div>
      </aside>
    </>
  );
};
