import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { CreateAccountInput, ProviderDescriptor, ProviderId } from '../../shared/types';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAccount: (input: CreateAccountInput) => Promise<void>;
  providers: ProviderDescriptor[];
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  onAddAccount,
  providers
}) => {
  const [provider, setProvider] = useState<ProviderId>('gemini');
  const [name, setName] = useState('');
  const [models, setModels] = useState('gemini-3-flash, gemini-2.5-flash');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [tokenBudgetM, setTokenBudgetM] = useState(0);
  const [maxConcurrent, setMaxConcurrent] = useState(4);
  const [priority, setPriority] = useState(1);
  const [weight, setWeight] = useState(50);
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const selected = providers.find(p => p.id === provider);

  const handleProviderChange = (id: ProviderId) => {
    setProvider(id);
    const descriptor = providers.find(p => p.id === id);
    // Prefill from the provider's catalogue so the common case needs no typing,
    // while leaving the field editable for a model the router has not heard of.
    setModels((descriptor?.suggestedModels ?? []).join(', '));
    setBaseUrl('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedKey = apiKey.trim();
    if (trimmedKey === '') {
      setError('Cần nhập API key.');
      return;
    }
    const resolvedBaseUrl = baseUrl.trim() || selected?.defaultBaseUrl || '';
    if (resolvedBaseUrl === '') {
      setError('Provider này cần Base URL.');
      return;
    }

    setSubmitting(true);
    try {
      await onAddAccount({
        name: name.trim(),
        provider,
        apiKey: trimmedKey,
        baseUrl: resolvedBaseUrl,
        models: models.split(',').map(m => m.trim()).filter(Boolean),
        priority: Number(priority),
        weight: Number(weight),
        maxConcurrent: Number(maxConcurrent),
        dailyTokenBudget: Math.round(Number(tokenBudgetM) * 1_000_000),
        tags: tags.split(',').map(t => t.trim()).filter(Boolean)
      });
      setApiKey('');
      setName('');
      setTags('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thêm được tài khoản.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-white">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-700">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Thêm tài khoản vào Pool</h3>
              <p className="text-[11px] text-slate-500">API key được mã hóa AES-256-GCM trước khi lưu</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 overflow-y-auto max-h-[80vh]">
          {error && (
            <div className="px-3 py-2 rounded-md bg-rose-50 border border-rose-200 text-xs text-rose-700">
              {error}
            </div>
          )}

          {/* Provider Select */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Nhà cung cấp (Provider)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {providers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderChange(p.id)}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium border text-center transition-colors cursor-pointer ${
                    provider === p.id
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {selected && (
              <p className="text-[10px] text-slate-400 mt-1 font-mono">
                Giao thức: {selected.protocol === 'gemini' ? 'Gemini' : 'OpenAI-compatible'}
              </p>
            )}
          </div>

          {/* Name & Models */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Tên gợi nhớ (Alias)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Ví dụ: ${selected?.label ?? 'Provider'}-01`}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Model phục vụ (phân cách dấu phẩy)
              </label>
              <input
                type="text"
                value={models}
                onChange={(e) => setModels(e.target.value)}
                placeholder="Để trống = nhận mọi model"
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'gemini' ? 'AIza...' : 'sk-...'}
              autoComplete="off"
              className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              Base URL {selected?.defaultBaseUrl ? '(để trống dùng mặc định)' : '(bắt buộc)'}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected?.defaultBaseUrl || 'https://.../v1'}
              className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
            />
          </div>

          {/* Budget & Concurrency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Hạn mức Token ngày (Triệu, 0 = không giới hạn)
              </label>
              <input
                type="number"
                min="0"
                max="1000"
                step="0.1"
                value={tokenBudgetM}
                onChange={(e) => setTokenBudgetM(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Request đồng thời tối đa
              </label>
              <input
                type="number"
                min="1"
                max="64"
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
          </div>

          {/* Priority and Weight */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Mức ưu tiên (Priority)
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:border-slate-400 cursor-pointer"
              >
                <option value={1}>P1 - Cao nhất (Primary)</option>
                <option value={2}>P2 - Trung bình cao</option>
                <option value={3}>P3 - Trung bình</option>
                <option value={4}>P4 - Dự phòng (Fallback)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Trọng số (Weight 1-100)
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              Nhãn (Phân cách bằng dấu phẩy)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Production, Fallback"
              className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
            />
          </div>

          {/* Buttons */}
          <div className="pt-2.5 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-medium transition-colors cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white text-xs font-medium shadow-xs transition-colors cursor-pointer"
            >
              {submitting ? 'Đang lưu...' : 'Thêm vào Pool'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
