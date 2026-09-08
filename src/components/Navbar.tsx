import React from 'react';
import { 
  Menu, 
  RotateCw, 
  Plus
} from 'lucide-react';

interface NavbarProps {
  onToggleMobileSidebar: () => void;
  onOpenAddModal: () => void;
  onQuickRotate: () => void;
  activeAccountName?: string;
  activeCount: number;
  totalCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  onToggleMobileSidebar,
  onOpenAddModal,
  onQuickRotate,
  activeAccountName,
  activeCount,
  totalCount
}) => {
  return (
    <header className="h-14 px-4 sm:px-6 bg-white/90 backdrop-blur-xs border-b border-slate-200 flex items-center justify-between sticky top-0 z-30">
      {/* Left: Mobile Toggle & Status Indicator */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMobileSidebar}
          className="p-1 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 lg:hidden cursor-pointer"
          title="Mở menu"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          {activeAccountName ? (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-slate-500 hidden sm:inline text-[11px]">Đang phục vụ:</span>
              <span className="text-slate-800 font-semibold font-mono text-xs truncate max-w-[180px] sm:max-w-[280px]">
                {activeAccountName}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
              <span>Chưa chỉ định tài khoản chính</span>
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          id="btn-navbar-rotate"
          onClick={onQuickRotate}
          className="px-3 py-1.5 rounded-md bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200 transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
          title="Xoay vòng sang tài khoản tiếp theo trong hàng đợi"
        >
          <RotateCw className="h-3.5 w-3.5 text-slate-500" />
          <span>Xoay Vòng</span>
        </button>

        <button
          id="btn-navbar-add"
          onClick={onOpenAddModal}
          className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Thêm Tài Khoản</span>
          <span className="sm:hidden">Thêm</span>
        </button>
      </div>
    </header>
  );
};
