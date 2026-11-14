import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, RefreshCw, RotateCcw, Trash2, Wifi, XCircle } from 'lucide-react';
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
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [secretMsg, setSecretMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [secretSaving, setSecretSaving] = useState(false);

  const AI_SECRET_KEYS = ['gemini_api_key', 'custom_ai_api_key', 'anthropic_api_key'];
  const aiSecrets = secrets.filter((s) => AI_SECRET_KEYS.includes(s.key));

  const handleSaveSecrets = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(secretDraft)) {
      if (v && v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) {
      setSecretMsg({ ok: false, text: '没有填写任何新密钥（留空表示不修改）' });
      return;
    }
    setSecretSaving(true);
    setSecretMsg(null);
    try {
      const res = await fetch('/api/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSecretMsg({ ok: false, text: data.error ?? '保存失败' });
      } else {
        setSecretDraft({});
        setSecretMsg({ ok: true, text: `已保存 ${data.changed?.length ?? 0} 项密钥，立即生效（无需重启）` });
        await onRefresh();
      }
    } catch (err) {
      setSecretMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setSecretSaving(false);
    }
  };

  const handleClearSecret = async (key: string) => {
    setSecretSaving(true);
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setSecretMsg({ ok: true, text: `已清除 ${key}` });
        await onRefresh();
      } else {
        setSecretMsg({ ok: false, text: data.error ?? '清除失败' });
      }
    } finally {
      setSecretSaving(false);
    }
  };

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

      {/* ===== 凭据（后台直接填写，不再需要改 .env） ===== */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold text-slate-900">AI 密钥（保存在服务端数据库，留空即不修改）</div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              填写后立即生效，无需重启服务；明文不经过导出接口，也不会回显到页面。
            </div>
          </div>
          <button
            type="button"
            disabled={secretSaving || busy}
            onClick={handleSaveSecrets}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <KeyRound className="h-3.5 w-3.5" />
            {secretSaving ? '保存中…' : '保存密钥'}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
          {aiSecrets.map((item) => (
            <div key={item.key} className="space-y-1">
              <div className="flex items-center justify-between gap-1">
                <label htmlFor={`secret-${item.key}`} className="block font-medium text-slate-700 truncate">
                  {item.label}
                </label>
                {item.configured ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-700 whitespace-nowrap">
                    <CheckCircle2 className="h-3 w-3" />
                    {item.source === 'db' ? '已保存' : '.env'} ··{item.tail}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-amber-700 whitespace-nowrap">
                    <XCircle className="h-3 w-3" />
                    未配置
                  </span>
                )}
              </div>
              <div className="flex gap-1">
                <input
                  id={`secret-${item.key}`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={secretDraft[item.key] ?? ''}
                  onChange={(e) => setSecretDraft((prev) => ({ ...prev, [item.key]: e.target.value }))}
                  placeholder={item.configured ? '已配置，留空不修改' : '粘贴密钥…'}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
                />
                {item.configured && item.source === 'db' ? (
                  <button
                    type="button"
                    title="清除后台保存的密钥（回退到 .env）"
                    disabled={secretSaving}
                    onClick={() => handleClearSecret(item.key)}
                    className="shrink-0 rounded border border-slate-300 bg-white px-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="text-[10px] text-slate-500">{item.hint}</div>
            </div>
          ))}
        </div>

        {secretMsg ? (
          <div className={`text-[11px] ${secretMsg.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{secretMsg.text}</div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4 text-xs">
        <div>
          <label htmlFor="ai-provider-select" className="block font-medium text-slate-700">
            接口协议
          </label>
          <select
            id="ai-provider-select"
            value={aiProvider}
            onChange={(e) => {
              const next = e.target.value as AiProviderType;
              setAiProvider(next);
              setFetchedModels([]);
              if (next === 'anthropic') {
                setAiModel('claude-3-7-sonnet-20250219');
              } else if (next === 'openai-compatible') {
                setAiModel('gpt-4o-mini');
              } else {
                setAiModel('gemini-4-hydrogen');
              }
            }}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          >
            <option value="gemini">Gemini 原生协议</option>
            <option value="openai-compatible">OpenAI 兼容协议 (/chat/completions)</option>
            <option value="anthropic">Anthropic Claude 协议 (/v1/messages)</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="ai-base-url" className="block font-medium text-slate-700">
            Base URL（可选，留空走官方默认端点）
          </label>
          <input
            id="ai-base-url"
            type="text"
            value={aiBaseUrl}
            onChange={(e) => setAiBaseUrl(e.target.value)}
            placeholder={
              aiProvider === 'gemini'
                ? 'https://generativelanguage.googleapis.com'
                : aiProvider === 'anthropic'
                  ? 'https://api.anthropic.com 或中转代理地址'
                  : 'https://api.openai.com/v1 或 DeepSeek / OneAPI 地址'
            }
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          />
        </div>

        <div>
          <label htmlFor="ai-thinking-level" className="block font-medium text-slate-700">
            思考强度 (对齐最高档)
          </label>
          <select
            id="ai-thinking-level"
            value={thinkingLevel}
            onChange={(e) => setThinkingLevel(e.target.value as ThinkingLevel)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          >
            <option value="max">最高档对齐 (xhigh / max / high 自动最高)</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
            <option value="off">off (关闭思考)</option>
          </select>
        </div>
      </div>

      {/* Dual Mode Model Selector + Manual Input + GET Fetch */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 items-end text-xs">
        <div className="md:col-span-5">
          <label htmlFor="ai-model-select" className="block font-medium text-slate-700">
            快速选择模型（支持从当前端口 GET 获取）
          </label>
          <select
            id="ai-model-select"
            value={modelChoices.includes(aiModel) ? aiModel : ''}
            onChange={(e) => {
              if (e.target.value) setAiModel(e.target.value);
            }}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          >
            {modelChoices.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {!modelChoices.includes(aiModel) && <option value="">自定义：{aiModel}</option>}
          </select>
        </div>

        <div className="md:col-span-5">
          <label htmlFor="ai-model-name" className="block font-medium text-slate-700">
            当前生效模型 ID（可直接手动填写任意模型名）
          </label>
          <input
            id="ai-model-name"
            type="text"
            required
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            placeholder={
              aiProvider === 'anthropic'
                ? 'claude-3-7-sonnet-20250219'
                : aiProvider === 'gemini'
                  ? 'gemini-4-hydrogen'
                  : 'gpt-4o-mini / deepseek-chat'
            }
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          />
        </div>

        <div className="md:col-span-2">
          <button
            type="button"
            disabled={fetchingModels}
            onClick={handleFetchModels}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${fetchingModels ? 'animate-spin' : ''}`} />
            {fetchingModels ? '获取中...' : 'GET 获取模型'}
          </button>
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
