import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, RefreshCw, RotateCcw, Save, Wifi } from 'lucide-react';
import type { AiProviderConfig, AiProviderType, ThinkingLevel } from '../../domain/types';

export interface SecretItem {
  key: string;
  env_name: string;
  label: string;
  hint: string;
  configured: boolean;
  source: 'db' | 'env' | null;
  tail: string | null;
}

interface AiSettingsCardProps {
  aiConfig: AiProviderConfig;
  defaultAiConfig: AiProviderConfig;
  secrets?: SecretItem[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  onRefresh: () => Promise<void>;
}

interface ProviderMeta {
  keyName: string;
  keyLabel: string;
  baseUrlPlaceholder: string;
  modelPlaceholder: string;
  note: string;
}

const PROVIDER_META: Record<AiProviderType, ProviderMeta> = {
  gemini: {
    keyName: 'gemini_api_key',
    keyLabel: 'Gemini API Key',
    baseUrlPlaceholder: '官方端点，无需填写',
    modelPlaceholder: 'gemini-4-hydrogen',
    note: 'Gemini 原生协议使用官方端点，Base URL 固定不可改。',
  },
  'openai-compatible': {
    keyName: 'custom_ai_api_key',
    keyLabel: 'OpenAI 兼容 Key',
    baseUrlPlaceholder: 'https://api.openai.com/v1 或 DeepSeek / OneAPI 地址',
    modelPlaceholder: 'gpt-4o-mini / deepseek-chat',
    note: '适用于 DeepSeek、OpenRouter、OneAPI 等兼容 /chat/completions 的服务。',
  },
  anthropic: {
    keyName: 'anthropic_api_key',
    keyLabel: 'Anthropic Key',
    baseUrlPlaceholder: 'https://api.anthropic.com 或中转代理地址',
    modelPlaceholder: 'claude-3-7-sonnet-20250219',
    note: '走 /v1/messages 协议，支持官方或兼容中转。',
  },
};

const PRESET_MODELS: Record<AiProviderType, string[]> = {
  gemini: ['gemini-4-hydrogen', 'gemini-2.5-pro', 'gemini-2.5-flash'],
  'openai-compatible': ['gpt-4o-mini', 'gpt-4.1', 'o3-mini', 'deepseek-chat', 'deepseek-reasoner'],
  anthropic: ['claude-3-7-sonnet-20250219', 'claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
};

export const AiSettingsCard: React.FC<AiSettingsCardProps> = ({
  aiConfig,
  defaultAiConfig,
  secrets = [],
  busy,
  setBusy,
  onRefresh,
}) => {
  const [aiProvider, setAiProvider] = useState<AiProviderType>(aiConfig.provider);
  const [aiBaseUrl, setAiBaseUrl] = useState(aiConfig.base_url);
  const [aiModel, setAiModel] = useState(aiConfig.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(aiConfig.thinking_level ?? 'max');
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [promptSpecgen, setPromptSpecgen] = useState(aiConfig.prompts.specgen_system);
  const [promptNextEp, setPromptNextEp] = useState(aiConfig.prompts.next_episode);
  const [promptComment, setPromptComment] = useState(aiConfig.prompts.comment_reply);
  const [aiSaveMsg, setAiSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiTesting, setAiTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [aiKeyDraft, setAiKeyDraft] = useState('');
  const [savingAiKey, setSavingAiKey] = useState(false);
  const [aiKeyMsg, setAiKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const activeProviderMeta = PROVIDER_META[aiProvider];
  const activeKeyName = activeProviderMeta.keyName;
  const activeKeyItem = secrets.find((s) => s.key === activeKeyName);
  useEffect(() => {
    setAiProvider(aiConfig.provider);
    setAiBaseUrl(aiConfig.base_url);
    setAiModel(aiConfig.model);
    setThinkingLevel(aiConfig.thinking_level ?? 'max');
    setPromptSpecgen(aiConfig.prompts.specgen_system);
    setPromptNextEp(aiConfig.prompts.next_episode);
    setPromptComment(aiConfig.prompts.comment_reply);
  }, [aiConfig]);

  const modelChoices = Array.from(
    new Set([...(fetchedModels.length > 0 ? fetchedModels : PRESET_MODELS[aiProvider]), aiModel].filter(Boolean))
  );

  const handleSaveAiKey = async () => {
    const v = aiKeyDraft.trim();
    if (!v) return;
    setSavingAiKey(true);
    setAiKeyMsg(null);
    try {
      const res = await fetch('/api/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets: { [activeKeyName]: v } }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiKeyMsg({ ok: false, text: data.error ?? '保存失败' });
      } else {
        setAiKeyDraft('');
        setAiKeyMsg({ ok: true, text: `${activeProviderMeta.keyLabel} 已保存，立即可用` });
        await onRefresh();
      }
    } catch (err) {
      setAiKeyMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setSavingAiKey(false);
    }
  };

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setAiSaveMsg(null);
    try {
      const qs = new URLSearchParams({ provider: aiProvider, base_url: aiBaseUrl });
      const res = await fetch(`/api/ai/models?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setAiSaveMsg({ ok: false, text: data.error ?? '获取模型列表失败' });
        return;
      }
      const list = Array.isArray(data.models) ? (data.models as string[]) : [];
      setFetchedModels(list);
      if (list.length > 0 && !list.includes(aiModel)) {
        setAiModel(list[0]);
      }
      setAiSaveMsg({
        ok: true,
        text: `已从 ${data.endpoint} 获取 ${list.length} 个可用模型`,
      });
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTestAiConnection = async () => {
    setAiTesting(true);
    setAiSaveMsg(null);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          base_url: aiBaseUrl,
          model: aiModel,
          thinking_level: thinkingLevel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiSaveMsg({ ok: false, text: `连通性测试失败：${data.error ?? '请求错误'}` });
      } else {
        setAiSaveMsg({
          ok: true,
          text: `连通正常！协议 ${data.provider} · 模型 ${data.model} · 实际对齐思考档位 ${data.applied_thinking ?? data.thinking_level} · 耗时 ${data.latency_ms}ms`,
        });
      }
    } finally {
      setAiTesting(false);
    }
  };

  const handleSaveAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setAiSaveMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/ai-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiProvider,
          base_url: aiBaseUrl,
          model: aiModel,
          thinking_level: thinkingLevel,
          prompts: {
            specgen_system: promptSpecgen,
            next_episode: promptNextEp,
            comment_reply: promptComment,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiSaveMsg({ ok: false, text: data.error ?? '保存 AI 配置失败' });
      } else {
        setAiSaveMsg({
          ok: true,
          text: `已保存 AI 配置（${data.ai_config?.provider} · ${data.ai_config?.model} · 思考档位 ${data.ai_config?.thinking_level}）`,
        });
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetAiPrompts = () => {
    setPromptSpecgen(defaultAiConfig.prompts.specgen_system);
    setPromptNextEp(defaultAiConfig.prompts.next_episode);
    setPromptComment(defaultAiConfig.prompts.comment_reply);
    setAiSaveMsg({ ok: true, text: '已恢复默认提示词模板，点击「保存 AI 配置」生效。' });
  };

  return (
    <form onSubmit={handleSaveAiConfig} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Bot className="h-4 w-4 text-slate-500" />
            AI 接口协议、模型拉取/选择、思考强度与提示词控制
          </div>
          <p className="mt-1 text-xs text-slate-500">
            支持 Gemini、OpenAI 兼容接口与 Anthropic Claude；选择「最高档对齐 (max)」时自动按 xhigh → max → high / 32k 探测接口最高档思考强度。
          </p>
        </div>
        <button
          type="button"
          onClick={handleResetAiPrompts}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          恢复默认提示词
        </button>
      </div>

      {/* ===== 协议 · 密钥 · 端点 · 模型 · 思考强度（一体化） ===== */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3.5 text-xs">
        {/* 第 1 行：协议 + 密钥 + 保存 */}
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-[230px] shrink-0">
            <label htmlFor="ai-provider-select" className="block font-medium text-slate-800">
              接口协议
            </label>
            <select
              id="ai-provider-select"
              value={aiProvider}
              onChange={(e) => {
                const next = e.target.value as AiProviderType;
                setAiProvider(next);
                setFetchedModels([]);
                setAiBaseUrl('');
                if (next === 'anthropic') {
                  setAiModel('claude-3-7-sonnet-20250219');
                } else if (next === 'openai-compatible') {
                  setAiModel('gpt-4o-mini');
                } else {
                  setAiModel('gemini-4-hydrogen');
                }
              }}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-xs"
            >
              <option value="gemini">Gemini 原生协议</option>
              <option value="openai-compatible">OpenAI 兼容 (/chat/completions)</option>
              <option value="anthropic">Anthropic Claude (/v1/messages)</option>
            </select>
          </div>

          <div className="min-w-[240px] flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`sk-${activeKeyName}`} className="block font-medium text-slate-800">
                {activeProviderMeta.keyLabel}
              </label>
              {activeKeyItem?.configured ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700"
                  title={`${activeKeyItem.source === 'db' ? '已保存到数据库' : '来自 .env'} ··${activeKeyItem.tail}`}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  已配置 ··{activeKeyItem.tail}
                </span>
              ) : (
                <span className="text-[10px] font-medium text-amber-600">未配置</span>
              )}
            </div>
            <input
              id={`sk-${activeKeyName}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={aiKeyDraft}
              onChange={(e) => setAiKeyDraft(e.target.value)}
              placeholder={
                activeKeyItem?.configured
                  ? '已配置，留空不修改'
                  : `粘贴 ${activeProviderMeta.keyLabel}`
              }
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
            />
          </div>

          <button
            type="button"
            disabled={!aiKeyDraft.trim() || savingAiKey}
            onClick={handleSaveAiKey}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-35"
          >
            {savingAiKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存密钥
          </button>
        </div>

        {aiKeyMsg ? (
          <div className={`text-[11px] font-medium ${aiKeyMsg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {aiKeyMsg.text}
          </div>
        ) : null}

        {/* 第 2 行：Base URL + 模型 + 思考强度 */}
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="ai-base-url" className="block font-medium text-slate-800">
              {aiProvider === 'gemini' ? 'API 端点' : 'Base URL'}
              {aiProvider !== 'gemini' && (
                <span className="ml-1 font-normal text-slate-500">留空走官方</span>
              )}
            </label>
            {aiProvider === 'gemini' ? (
              <div
                id="ai-base-url"
                className="mt-1 truncate rounded border border-slate-200 bg-slate-100/70 px-2.5 py-1.5 font-mono text-[11px] text-slate-500"
                title="Gemini 原生协议固定使用官方端点"
              >
                https://generativelanguage.googleapis.com
              </div>
            ) : (
              <input
                id="ai-base-url"
                type="text"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                placeholder={activeProviderMeta.baseUrlPlaceholder}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-[11px]"
              />
            )}
          </div>

          <div className="min-w-[180px] flex-1">
            <label htmlFor="ai-model-select" className="block font-medium text-slate-800">
              模型
            </label>
            <div className="mt-1 flex gap-1">
              <select
                id="ai-model-select"
                value={modelChoices.includes(aiModel) ? aiModel : ''}
                onChange={(e) => {
                  if (e.target.value) setAiModel(e.target.value);
                }}
                className="w-full min-w-0 rounded border border-slate-300 px-2.5 py-1.5 font-mono text-[11px]"
              >
                {modelChoices.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                {!modelChoices.includes(aiModel) && <option value="">自定义：{aiModel}</option>}
              </select>
              <button
                type="button"
                disabled={fetchingModels || aiProvider === 'gemini'}
                onClick={handleFetchModels}
                title="从当前端点 GET /models 拉取（Gemini 原生协议不支持）"
                className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="w-[180px] shrink-0">
            <label htmlFor="ai-thinking-level" className="block font-medium text-slate-800">
              思考强度
            </label>
            <select
              id="ai-thinking-level"
              value={thinkingLevel}
              onChange={(e) => setThinkingLevel(e.target.value as ThinkingLevel)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 text-[11px]"
            >
              <option value="max">最高档对齐 (自动)</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
              <option value="off">off</option>
            </select>
          </div>
        </div>

        {/* 第 3 行：模型 ID 手填 + 当前协议提示 */}
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="w-full">
            <label htmlFor="ai-model-name" className="block font-medium text-slate-800">
              模型 ID（可直接手填任意模型名）
            </label>
            <input
              id="ai-model-name"
              type="text"
              required
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder={activeProviderMeta.modelPlaceholder}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-[11px]"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 text-xs">
        <div className="lg:col-span-2">
          <label htmlFor="prompt-specgen" className="block font-medium text-slate-700">
            SpecGen 主生成与选题系统提示词（控制 Hook 风格、时长区间、差异化规则）
          </label>
          <textarea
            id="prompt-specgen"
            rows={5}
            value={promptSpecgen}
            onChange={(e) => setPromptSpecgen(e.target.value)}
            className="mt-1 w-full rounded border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
        <div className="space-y-3">
          <div>
            <label htmlFor="prompt-next-ep" className="block font-medium text-slate-700">
              「做下一集」续集提示词
            </label>
            <textarea
              id="prompt-next-ep"
              rows={2}
              value={promptNextEp}
              onChange={(e) => setPromptNextEp(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="prompt-comment" className="block font-medium text-slate-700">
              评论回复与风控起草提示词
            </label>
            <textarea
              id="prompt-comment"
              rows={2}
              value={promptComment}
              onChange={(e) => setPromptComment(e.target.value)}
              className="mt-1 w-full rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="text-xs min-h-[20px]">
          {aiSaveMsg && (
            <span className={aiSaveMsg.ok ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
              {aiSaveMsg.text}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={aiTesting}
            onClick={handleTestAiConnection}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Wifi className="h-3.5 w-3.5" />
            {aiTesting ? '测试中...' : '测试连通性'}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            保存 AI 配置
          </button>
        </div>
      </div>
    </form>
  );
};
