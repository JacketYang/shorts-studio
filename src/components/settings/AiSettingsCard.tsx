import React, { useEffect, useState } from 'react';
import { Bot, RefreshCw, RotateCcw, Wifi } from 'lucide-react';
import type { AiProviderConfig, AiProviderType, ThinkingLevel } from '../../domain/types';

interface AiSettingsCardProps {
  aiConfig: AiProviderConfig;
  defaultAiConfig: AiProviderConfig;
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
