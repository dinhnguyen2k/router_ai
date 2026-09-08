import React, { useState } from 'react';
import { X, Plus, Database } from 'lucide-react';
import { AIAccount, ProviderType } from '../types';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddAccount: (account: AIAccount) => void;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  isOpen,
  onClose,
  onAddAccount
}) => {
  const [provider, setProvider] = useState<ProviderType>('OpenAI');
  const [name, setName] = useState('');
  const [modelTier, setModelTier] = useState('GPT-4o / Tier 5');
  const [apiKey, setApiKey] = useState('');
  const [tokenLimitM, setTokenLimitM] = useState(10);
  const [dailyBudget, setDailyBudget] = useState(100);
  const [priority, setPriority] = useState(1);
  const [weight, setWeight] = useState(80);
  const [tags, setTags] = useState('Production, High-Throughput');

  if (!isOpen) return null;

  const handleProviderChange = (p: ProviderType) => {
    setProvider(p);
    switch (p) {
      case 'OpenAI':
        setModelTier('GPT-4o / o1-mini');
        break;
      case 'Google Gemini':
        setModelTier('Gemini 1.5 Pro / Flash 2.0');
        break;
      case 'Anthropic':
        setModelTier('Claude 3.5 Sonnet / Opus');
        break;
      case 'DeepSeek':
        setModelTier('DeepSeek V3 / R1 Reasoner');
        break;
      case 'Groq':
        setModelTier('Llama 3.3 70B Fast');
        break;
      case 'Mistral AI':
        setModelTier('Mistral Large 2');
        break;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const accountName = name.trim() || `${provider}-Instance-${Math.floor(Math.random() * 899 + 100)}`;
    const maskedKey = apiKey ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}` : `sk-${provider.toLowerCase().slice(0, 3)}-...${Math.floor(Math.random() * 8999 + 1000)}`;

    const newAcc: AIAccount = {
      id: `acc-${Date.now()}`,
      name: accountName,
      provider,
      modelTier,
      apiKeyMasked: maskedKey,
      status: 'active',
      priority: Number(priority),
      weight: Number(weight),
      quota: {
        usedTokens: 0,
        totalTokens: tokenLimitM * 1_000_000,
        rpmCurrent: 0,
        rpmLimit: 5_000,
        tpmCurrent: 0,
        tpmLimit: 1_000_000,
        dailySpentUsd: 0,
        dailyBudgetUsd: Number(dailyBudget),
        resetTime: '00:00 UTC'
      },
      cooldown: {
        isInCooldown: false,
        remainingSeconds: 0,
        totalDurationSeconds: 120,
        reason: 'Sẵn sàng',
        triggerTimestamp: 'Vừa tạo'
      },
      successRate: 100,
      lastUsedAt: 'Chưa sử dụng',
      totalRequestsToday: 0,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean)
    };

    onAddAccount(newAcc);
    onClose();
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
              <p className="text-[11px] text-slate-500">Cấu hình thông số hạn mức và trọng số xoay vòng</p>
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
          {/* Provider Select */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Nhà cung cấp (Provider)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['OpenAI', 'Google Gemini', 'Anthropic', 'DeepSeek', 'Groq', 'Mistral AI'] as ProviderType[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleProviderChange(p)}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium border text-center transition-colors cursor-pointer ${
                    provider === p
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Name & Model Tier */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Tên gợi nhớ (Alias)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`Ví dụ: ${provider}-Prod-01`}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Gói Model / Tier
              </label>
              <input
                type="text"
                value={modelTier}
                onChange={(e) => setModelTier(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">
              API Key (Masked tự động khi lưu)
            </label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-slate-400"
            />
          </div>

          {/* Quota Limits */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Hạn mức Token ngày (Triệu)
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={tokenLimitM}
                onChange={(e) => setTokenLimitM(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-mono text-slate-900 focus:outline-hidden focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                Ngân sách ngày ($ USD)
              </label>
              <input
                type="number"
                min="5"
                max="10000"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(Number(e.target.value))}
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
              placeholder="Production, Fallback, High-Throughput"
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
              className="px-3 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium shadow-xs transition-colors cursor-pointer"
            >
              Thêm vào Pool
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
