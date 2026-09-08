import React, { useState } from 'react';
import { Sliders, Save, CheckCircle2, ShieldCheck, BellRing, Zap } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [cooldownSec, setCooldownSec] = useState(180);
  const [warningThreshold, setWarningThreshold] = useState(85);
  const [autoReactivate, setAutoReactivate] = useState(true);
  const [failoverTries, setFailoverTries] = useState(3);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800/90 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Sliders className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Cấu Hình Ngưỡng Quota & Chính Sách Cooldown
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Thiết lập hành vi tự động khi các tài khoản AI chạm trần hạn mức hoặc gặp mã lỗi 429
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800/90 space-y-5">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-400" />
            Thông số Cooldown Mặc Định
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Thời gian Cooldown mặc định khi dính 429 (giây)
              </label>
              <input
                type="number"
                value={cooldownSec}
                onChange={(e) => setCooldownSec(Number(e.target.value))}
                min={30}
                max={3600}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:border-indigo-500 focus:outline-hidden"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Tài khoản sẽ bị tạm rút khỏi pool trong thời gian này và tự động tái kiểm tra.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Số lần retry tối đa trước khi cô lập tài khoản (Failover Retries)
              </label>
              <input
                type="number"
                value={failoverTries}
                onChange={(e) => setFailoverTries(Number(e.target.value))}
                min={1}
                max={10}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:border-indigo-500 focus:outline-hidden"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Nếu liên tục thất bại quá số lần này, account sẽ bị đổi trạng thái sang Suspended.
              </p>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-200 block">Tự động kích hoạt lại sau Cooldown</span>
              <span className="text-[11px] text-slate-400">Đưa tài khoản trở lại hàng đợi phục vụ ngay khi bộ đếm lùi về 0</span>
            </div>
            <button
              type="button"
              onClick={() => setAutoReactivate(!autoReactivate)}
              className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                autoReactivate ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
            >
              <span 
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  autoReactivate ? 'translate-x-6' : 'translate-x-0'
                }`} 
              />
            </button>
          </div>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800/90 space-y-5">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            Cảnh Báo Trần Hạn Mức Quota
          </h3>

          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-300">Ngưỡng cảnh báo cạn Quota (% đã dùng):</span>
              <span className="font-mono font-bold text-amber-400">{warningThreshold}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={95}
              value={warningThreshold}
              onChange={(e) => setWarningThreshold(Number(e.target.value))}
              className="w-full accent-indigo-500 cursor-pointer"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Khi đạt {warningThreshold}% quota ngày, hệ thống sẽ tự động hạ trọng số Weight để ưu tiên tài khoản khác.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {savedSuccess && (
            <span className="text-xs text-emerald-400 flex items-center gap-1.5 animate-in fade-in">
              <CheckCircle2 className="h-4 w-4" /> Đã lưu cấu hình ngưỡng an toàn!
            </span>
          )}
          <button
            type="submit"
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Save className="h-4 w-4" />
            Lưu Cấu Hình
          </button>
        </div>
      </form>
    </div>
  );
};
