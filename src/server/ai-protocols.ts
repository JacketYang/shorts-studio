import { GoogleGenAI } from '@google/genai';
import type { AiProviderConfig, AiProviderType, ThinkingLevel } from '../domain/types.ts';
import { DEFAULT_AI_CONFIG, normalizeAiConfig } from './store.ts';

export const GEMINI_MODEL_T1 = 'gemini-4-hydrogen';

export function resolveServerAiKey(provider: AiProviderType): string | null {
  const custom = process.env.CUSTOM_AI_API_KEY?.trim();
  const gemini = process.env.GEMINI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const validCustom = custom && !custom.startsWith('MY_') ? custom : null;
  const validGemini = gemini && gemini !== 'MY_GEMINI_API_KEY' ? gemini : null;
  const validAnthropic = anthropic && !anthropic.startsWith('MY_') ? anthropic : null;

  if (provider === 'anthropic') {
    return validAnthropic ?? validCustom ?? validGemini;
  }
  if (provider === 'openai-compatible') {
    return validCustom ?? validGemini ?? validAnthropic;
  }
  return validGemini ?? validCustom;
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function defaultModelForProvider(provider: AiProviderType): string {
  if (provider === 'anthropic') return 'claude-3-7-sonnet-20250219';
  if (provider === 'openai-compatible') return 'gpt-4o-mini';
  return GEMINI_MODEL_T1;
}

/**
 * Resolve ordered cascade of thinking parameters for each protocol.
 * For `max`, tries the highest provider-specific ceiling first (e.g. `xhigh` -> `max` -> `high`,
 * `32000` -> `16000` -> `8192`, `32768` -> `24576` -> `8192`) and falls back gracefully on 400/unsupported errors.
 */
export function buildThinkingCascade(
  provider: AiProviderType,
  level: ThinkingLevel
): Array<{ label: string; value: string | number | null }> {
  if (level === 'off') {
    return [{ label: 'off', value: null }];
  }

  if (provider === 'openai-compatible') {
    if (level === 'max') {
      return [
        { label: 'xhigh', value: 'xhigh' },
        { label: 'max', value: 'max' },
        { label: 'high', value: 'high' },
        { label: 'omitted', value: null },
      ];
    }
    return [
      { label: level, value: level },
      { label: 'omitted', value: null },
    ];
  }

  if (provider === 'anthropic') {
    if (level === 'max') {
      return [
        { label: 'budget:32000', value: 32000 },
        { label: 'budget:16000', value: 16000 },
        { label: 'budget:8192', value: 8192 },
        { label: 'omitted', value: null },
      ];
    }
    const budget = level === 'high' ? 16000 : level === 'medium' ? 4096 : 1024;
    return [
      { label: `budget:${budget}`, value: budget },
      { label: 'omitted', value: null },
    ];
  }

  // Gemini native
  if (level === 'max') {
    return [
      { label: 'budget:32768', value: 32768 },
      { label: 'budget:24576', value: 24576 },
      { label: 'budget:8192', value: 8192 },
      { label: 'omitted', value: null },
    ];
  }
  const budget = level === 'high' ? 16384 : level === 'medium' ? 4096 : 1024;
  return [
    { label: `budget:${budget}`, value: budget },
    { label: 'omitted', value: null },
  ];
}

export async function fetchAvailableAiModels(params: {
  provider: AiProviderType;
  base_url?: string;
}): Promise<{ models: string[]; endpoint: string }> {
  const provider = params.provider;
  const apiKey = resolveServerAiKey(provider);
  if (!apiKey) {
    throw new Error(
      provider === 'anthropic'
        ? '未检测到服务端 ANTHROPIC_API_KEY 或 CUSTOM_AI_API_KEY，无法从远端端口拉取模型列表。'
        : provider === 'openai-compatible'
          ? '未检测到服务端 CUSTOM_AI_API_KEY 或 GEMINI_API_KEY，无法拉取模型列表。'
          : '未检测到服务端 GEMINI_API_KEY，无法拉取模型列表。'
    );
  }

  const rawBase = (params.base_url ?? '').trim().replace(/\/+$/, '');

  if (provider === 'gemini') {
    const base = rawBase || 'https://generativelanguage.googleapis.com';
    const endpoint = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(endpoint, { method: 'GET' });
    const data = (await res.json()) as { models?: Array<{ name?: string }>; error?: { message?: string } };
    if (!res.ok) {
      throw new Error(data.error?.message || `获取 Gemini 模型失败 (HTTP ${res.status})`);
    }
    const models = (data.models ?? [])
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    return { models: Array.from(new Set(models)), endpoint: `${base}/v1beta/models` };
  }

  if (provider === 'anthropic') {
    const base = rawBase ? rawBase.replace(/\/v1(\/messages)?$/, '') : 'https://api.anthropic.com';
    const endpoint = `${base}/v1/models`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    });
    const data = (await res.json()) as { data?: Array<{ id?: string }>; error?: { message?: string } };
    if (!res.ok) {
      throw new Error(data.error?.message || `获取 Anthropic 模型失败 (HTTP ${res.status})`);
    }
    const models = (data.data ?? []).map((m) => String(m.id || '')).filter(Boolean);
    return { models: Array.from(new Set(models)), endpoint };
  }

  // OpenAI-compatible GET /models
  const base = rawBase ? rawBase.replace(/\/chat\/completions$/, '') : 'https://api.openai.com/v1';
  const endpoint = base.endsWith('/v1') || base.includes('/v1/') ? `${base}/models` : `${base}/v1/models`;
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const data = (await res.json()) as { data?: Array<{ id?: string }>; error?: { message?: string } };
  if (!res.ok) {
    throw new Error(data.error?.message || `获取 OpenAI 兼容模型失败 (HTTP ${res.status})`);
  }
  const models = (data.data ?? []).map((m) => String(m.id || '')).filter(Boolean);
  return { models: Array.from(new Set(models)), endpoint };
}

export async function callStructuredAi(params: {
  aiConfig?: AiProviderConfig;
  systemInstruction?: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  expectArray?: boolean;
}): Promise<{
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  appliedThinking: string;
}> {
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);
  const apiKey = resolveServerAiKey(cfg.provider);
  if (!apiKey) {
    throw new Error(
      cfg.provider === 'anthropic'
        ? '未检测到服务端 ANTHROPIC_API_KEY 或 CUSTOM_AI_API_KEY，请在服务端 .env / Secrets 配置后调用 AI。'
        : cfg.provider === 'openai-compatible'
          ? '未检测到服务端 CUSTOM_AI_API_KEY 或 GEMINI_API_KEY，请在服务端 .env / Secrets 配置后调用 AI。'
          : '未检测到服务端 GEMINI_API_KEY，请在服务端 .env / Secrets 配置后调用 AI。'
    );
  }

  const activeModel = cfg.model.trim() || defaultModelForProvider(cfg.provider);
  const cascade = buildThinkingCascade(cfg.provider, cfg.thinking_level);

  if (cfg.provider === 'anthropic') {
    const rawBase = (cfg.base_url.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
    const endpoint = rawBase.endsWith('/messages')
      ? rawBase
      : rawBase.endsWith('/v1')
        ? `${rawBase}/messages`
        : `${rawBase}/v1/messages`;

    const sys = [
      params.systemInstruction ?? '',
      `Output strictly valid JSON ${params.expectArray ? 'array ([...])' : 'object ({...})'} with NO markdown fences or commentary.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    let lastError = 'Anthropic 接口调用失败';
    for (let i = 0; i < cascade.length; i++) {
      const step = cascade[i];
      const budget = typeof step.value === 'number' ? step.value : 0;
      const payload: Record<string, unknown> = {
        model: activeModel,
        max_tokens: budget > 0 ? budget + 4096 : 4096,
        system: sys,
        messages: [{ role: 'user', content: params.prompt }],
      };
      if (budget > 0) {
        payload.thinking = { type: 'enabled', budget_tokens: budget };
      } else {
        payload.temperature = 0.7;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (res.ok) {
        const textBlock = (data.content ?? []).find((b) => b.type === 'text' || typeof b.text === 'string');
        return {
          text: stripJsonFence(textBlock?.text ?? (params.expectArray ? '[]' : '{}')),
          tokensIn: data.usage?.input_tokens ?? 900,
          tokensOut: data.usage?.output_tokens ?? 600,
          model: activeModel,
          appliedThinking: step.label,
        };
      }
      lastError = data.error?.message || `Anthropic 接口调用失败 (HTTP ${res.status})`;
      if (res.status !== 400 && res.status !== 422) {
        break;
      }
    }
    throw new Error(lastError);
  }

  if (cfg.provider === 'openai-compatible') {
    const rawBase = (cfg.base_url.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const endpoint = rawBase.endsWith('/chat/completions') ? rawBase : `${rawBase}/chat/completions`;
    const sys = [
      params.systemInstruction ?? '',
      `Output strictly valid JSON ${params.expectArray ? 'array ([...])' : 'object ({...})'} with NO markdown fences or commentary.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    let lastError = 'OpenAI 兼容接口调用失败';
    for (let i = 0; i < cascade.length; i++) {
      const step = cascade[i];
      const payload: Record<string, unknown> = {
        model: activeModel,
        temperature: 0.7,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: params.prompt },
        ],
      };
      if (typeof step.value === 'string') {
        payload.reasoning_effort = step.value;
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: { message?: string };
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      if (res.ok) {
        return {
          text: stripJsonFence(data.choices?.[0]?.message?.content ?? (params.expectArray ? '[]' : '{}')),
          tokensIn: data.usage?.prompt_tokens ?? 900,
          tokensOut: data.usage?.completion_tokens ?? 600,
          model: activeModel,
          appliedThinking: step.label,
        };
      }
      lastError = data.error?.message || `OpenAI 兼容接口调用失败 (HTTP ${res.status})`;
      if (res.status !== 400 && res.status !== 422) {
        break;
      }
    }
    throw new Error(lastError);
  }

  // Gemini native
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: cfg.base_url.trim() || undefined,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  let lastErr: unknown;
  for (let i = 0; i < cascade.length; i++) {
    const step = cascade[i];
    const config: Record<string, unknown> = {
      systemInstruction: params.systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: params.responseSchema,
    };
    if (typeof step.value === 'number' && step.value > 0) {
      config.thinkingConfig = { thinkingBudget: step.value };
    } else if (cfg.thinking_level === 'off') {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
    try {
      const response = await ai.models.generateContent({
        model: activeModel,
        contents: params.prompt,
        config,
      });
      return {
        text: stripJsonFence(response.text ?? (params.expectArray ? '[]' : '{}')),
        tokensIn: response.usageMetadata?.promptTokenCount ?? 1000,
        tokensOut: response.usageMetadata?.candidatesTokenCount ?? 700,
        model: activeModel,
        appliedThinking: step.label,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gemini 接口调用失败');
}

export async function testAiConnection(aiConfigInput: Partial<AiProviderConfig>): Promise<{
  ok: boolean;
  provider: AiProviderType;
  model: string;
  thinking_level: ThinkingLevel;
  applied_thinking: string;
  latency_ms: number;
  tokens_in: number;
  tokens_out: number;
  reply: string;
}> {
  const cfg = normalizeAiConfig(aiConfigInput);
  const started = Date.now();
  const res = await callStructuredAi({
    aiConfig: cfg,
    systemInstruction: 'Return strictly valid JSON {"ok":true,"status":"ready"} with no extra commentary.',
    prompt: 'Connection health check. Reply with JSON {"ok":true,"status":"ready"}.',
    expectArray: false,
    responseSchema: {
      type: 'OBJECT',
      properties: {
        ok: { type: 'BOOLEAN' },
        status: { type: 'STRING' },
      },
      required: ['ok', 'status'],
    },
  });
  return {
    ok: true,
    provider: cfg.provider,
    model: res.model,
    thinking_level: cfg.thinking_level,
    applied_thinking: res.appliedThinking,
    latency_ms: Date.now() - started,
    tokens_in: res.tokensIn,
    tokens_out: res.tokensOut,
    reply: res.text.slice(0, 120),
  };
}
