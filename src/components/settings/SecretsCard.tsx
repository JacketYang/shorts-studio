import React, { useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Save, Trash2, XCircle } from 'lucide-react';

export interface SecretItem {
  key: string;
  env_name: string;
  label: string;
  hint: string;
  configured: boolean;
  source: 'db' | 'env' | null;
  tail: string | null;
}

interface SecretsCardProps {
  secrets: SecretItem[];
  onRefresh: () => Promise<void>;
}

/** 分组展示，顺序决定页面呈现 */
const GROUPS: Array<{ title: string; desc: string; keys: string[] }> = [
  {
    title: 'AI 模型服务',
    desc: '至少配置一个即可启用 AI 生成 / 评论回复 / 趋势转译（按「AI 接口协议」选择对应的那个）',
    keys: ['gemini_api_key', 'custom_ai_api_key', 'anthropic_api_key'],
  },
  {
    title: 'YouTube 平台凭据',
    desc: '查询公开数据、参考频道、以及频道 OAuth 授权与上传（Client ID/Secret 所有频道共用 1 套）',
    keys: ['youtube_api_key', 'google_client_id', 'google_client_secret'],
  },
  {
    title: '对象存储（可选）',
    desc: '仅当存储驱动切到 s3 / webdav 时需要；保持 local 本地目录则无需填写',
    keys: [
      'storage_access_key_id',
      'storage_secret_access_key',
      'webdav_username',
      'webdav_password',
    ],
  },
];

export const SecretsCard: React.FC<SecretsCardProps> = ({ secrets, onRefresh }) => {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPlain, setShowPlain] = useState<Record<string, boolean>>({});

  const byKey = useMemo(() => {
    const m = new Map<string, SecretItem>();
    for (const s of secrets) m.set(s.key, s);
    return m;
  }, [secrets]);

  const configuredCount = secrets.filter((s) => s.configured).length;

  const handleSave = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v && v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) {
      setMsg({ ok: false, text: '没有填写任何新内容（留空表示不修改）' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/secrets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secrets: payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ ok: false, text: data.error ?? '保存失败' });
      } else {
        setDraft({});
        setMsg({
          ok: true,
          text: `已保存 ${data.changed?.length ?? 0} 项，立即生效（无需重启服务）`,
        });
        await onRefresh();
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (key: string) => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(key)}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok) {
        setDraft((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setMsg({ ok: true, text: `已清除 ${key}（若 .env 里仍有同名变量，会自动回退使用它）` });
        await onRefresh();
      } else {
        setMsg({ ok: false, text: data.error ?? '清除失败' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <KeyRound className="h-4 w-4 text-slate-500" />
            平台凭据管理
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-normal text-slate-600">
              {configuredCount}/{secrets.length} 已配置
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            所有 Key / Secret 均可在此填写并保存在服务端数据库，<strong className="font-semibold text-slate-700">保存后立即生效，无需重启或改 .env</strong>。
            明文不会回显到页面，也不会出现在「导出备份」中。
          </p>
        </div>
        <button
          type="button"
          disabled={saving || Object.values(draft).every((v) => !v || !v.trim())}
          onClick={handleSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? '保存中…' : '保存全部改动'}
        </button>
      </div>

      {GROUPS.map((group) => {
        const items = group.keys.map((k) => byKey.get(k)).filter(Boolean) as SecretItem[];
        if (items.length === 0) return null;
        return (
          <div key={group.title} className="space-y-2.5">
            <div className="border-b border-slate-100 pb-1.5">
              <div className="text-xs font-semibold text-slate-800">{group.title}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{group.desc}</div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {items.map((item) => {
                const draftVal = draft[item.key] ?? '';
                const plain = showPlain[item.key] ?? false;
                return (
                  <div key={item.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`secret-input-${item.key}`}
                        className="truncate text-xs font-medium text-slate-700"
                      >
                        {item.label}
                      </label>
                      {item.configured ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {item.source === 'db' ? '已保存' : '.env'} ··{item.tail}
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-medium text-amber-600">
                          <XCircle className="h-3 w-3" />
                          未配置
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <input
                        id={`secret-input-${item.key}`}
                        type={plain ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        value={draftVal}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, [item.key]: e.target.value }))
                        }
                        placeholder={item.configured ? '已配置，留空则不修改' : '粘贴后点右侧「保存全部改动」'}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
                      />
                      {draftVal ? (
                        <button
                          type="button"
                          title={plain ? '隐藏' : '显示明文'}
                          onClick={() =>
                            setShowPlain((prev) => ({ ...prev, [item.key]: !plain }))
                          }
                          className="shrink-0 rounded border border-slate-300 bg-white px-1.5 text-[10px] text-slate-600 hover:bg-slate-50"
                        >
                          {plain ? '隐藏' : '显示'}
                        </button>
                      ) : null}
                      {item.configured && item.source === 'db' ? (
                        <button
                          type="button"
                          title="清除后台保存的值（若 .env 有同名变量会自动回退）"
                          disabled={saving}
                          onClick={() => handleClear(item.key)}
                          className="shrink-0 rounded border border-slate-300 bg-white px-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-500">{item.hint}</span>
                      <span className="shrink-0 font-mono text-[10px] text-slate-400">
                        {item.env_name}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {msg ? (
        <div
          className={`rounded border px-3 py-2 text-[11px] font-medium ${
            msg.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
};
