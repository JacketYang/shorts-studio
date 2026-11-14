import React, { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Eye, EyeOff, KeyRound, Loader2, Save, Trash2 } from 'lucide-react';

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

interface Group {
  id: string;
  title: string;
  desc: string;
  keys: string[];
  /** AI 组单独一个保存按钮（更新频繁） */
  ownSave: boolean;
}

const GROUPS: Group[] = [
  {
    id: 'yt',
    title: 'YouTube 平台',
    desc: '公开数据查询与频道 OAuth 授权',
    keys: ['youtube_api_key', 'google_client_id', 'google_client_secret'],
    ownSave: false,
  },
  {
    id: 'storage',
    title: '对象存储',
    desc: '仅 s3 / webdav 驱动需要，local 无需填写',
    keys: ['storage_access_key_id', 'storage_secret_access_key', 'webdav_username', 'webdav_password'],
    ownSave: false,
  },
];

export const SecretsCard: React.FC<SecretsCardProps> = ({ secrets, onRefresh }) => {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [savingGroup, setSavingGroup] = useState<string | null>(null);
  const [clearingKey, setClearingKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const byKey = useMemo(() => {
    const m = new Map<string, SecretItem>();
    for (const s of secrets) m.set(s.key, s);
    return m;
  }, [secrets]);

  const configuredCount = secrets.filter((s) => s.configured).length;

  const pendingIn = (keys: string[]) => keys.some((k) => (draft[k] ?? '').trim() !== '');

  const handleSave = async (group: Group) => {
    const payload: Record<string, string> = {};
    for (const k of group.keys) {
      const v = (draft[k] ?? '').trim();
      if (v) payload[k] = v;
    }
    if (Object.keys(payload).length === 0) return;

    setSavingGroup(group.id);
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
        setDraft((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(payload)) delete next[k];
          return next;
        });
        setMsg({ ok: true, text: `${group.title}：已保存 ${data.changed?.length ?? 0} 项，立即生效` });
        await onRefresh();
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setSavingGroup(null);
    }
  };

  const handleClear = async (key: string) => {
    setClearingKey(key);
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
        setMsg({ ok: true, text: `已清除 ${key}` });
        await onRefresh();
      } else {
        setMsg({ ok: false, text: data.error ?? '清除失败' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setClearingKey(null);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* 头部 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-4 w-4 text-slate-700" />
          <span className="text-sm font-bold text-slate-900">平台凭据</span>
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${
              configuredCount === secrets.length
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {configuredCount}/{secrets.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
        >
          {expanded ? '收起' : '编辑凭据'}
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* 收起态：一行徽章 */}
      {!expanded && (
        <div className="flex flex-wrap gap-1.5 px-5 py-3">
          {secrets.map((item) => (
            <span
              key={item.key}
              title={
                item.configured
                  ? `${item.label} · ${item.source === 'db' ? '数据库' : '.env'} ··${item.tail}`
                  : `${item.label} · 未配置`
              }
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                item.configured
                  ? 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                  : 'bg-slate-50 text-slate-500 ring-1 ring-inset ring-slate-200'
              }`}
            >
              {item.configured ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              )}
              {item.label
                .replace(' API Key', '')
                .replace(' Secret Access Key', ' Secret')
                .replace(' Access Key ID', ' Key ID')
                .replace('Google OAuth ', 'OAuth ')
                .replace('YouTube Data', 'YouTube')}
            </span>
          ))}
        </div>
      )}

      {/* 展开态 */}
      {expanded && (
        <div className="divide-y divide-slate-100">
          {GROUPS.map((group) => {
            const items = group.keys
              .map((k) => byKey.get(k))
              .filter(Boolean) as SecretItem[];
            if (items.length === 0) return null;
            const dirty = pendingIn(group.keys);
            const busy = savingGroup === group.id;

            return (
              <div key={group.id} className="px-5 py-4">
                {/* 组头：标题 + 描述 + 保存按钮 */}
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-slate-900">{group.title}</span>
                    <span className="text-[11px] text-slate-500">{group.desc}</span>
                  </div>
                  <button
                    type="button"
                    disabled={!dirty || busy}
                    onClick={() => handleSave(group)}
                    className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      dirty
                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                        : 'cursor-not-allowed bg-slate-100 text-slate-400'
                    }`}
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    {busy ? '保存中' : '保存'}
                  </button>
                </div>

                {/* 字段：标签一行，输入框一行，图标内嵌右侧 */}
                <div className="grid grid-cols-1 gap-x-8 gap-y-2.5 lg:grid-cols-2">
                  {items.map((item) => {
                    const val = draft[item.key] ?? '';
                    const plain = revealed[item.key] ?? false;
                    const clearing = clearingKey === item.key;
                    return (
                      <div key={item.key} className="flex items-center gap-2">
                        <span
                          className="w-1.5 shrink-0"
                          title={
                            item.configured
                              ? `${item.source === 'db' ? '已保存到数据库' : '来自 .env'} ··${item.tail}`
                              : '未配置'
                          }
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              item.configured
                                ? item.source === 'db'
                                  ? 'bg-emerald-500'
                                  : 'bg-sky-400'
                                : 'bg-slate-200'
                            }`}
                          />
                        </span>
                        <label
                          htmlFor={`sk-${item.key}`}
                          title={item.hint}
                          className="w-[152px] shrink-0 truncate text-xs font-medium text-slate-800"
                        >
                          {item.label}
                        </label>

                        <div className="relative min-w-0 flex-1">
                          <input
                            id={`sk-${item.key}`}
                            type={plain ? 'text' : 'password'}
                            autoComplete="off"
                            spellCheck={false}
                            value={val}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, [item.key]: e.target.value }))
                            }
                            placeholder={
                              item.configured
                                ? `已配置（${item.source === 'db' ? '数据库' : '.env'}），粘贴新值以替换`
                                : '未配置，粘贴后点保存'
                            }
                            className="w-full rounded border border-slate-300 bg-white py-1 pl-2 pr-[52px] font-mono text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500/20"
                          />
                          {/* 框内右侧操作 */}
                          <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-0.5">
                            {val ? (
                              <button
                                type="button"
                                title={plain ? '隐藏' : '显示明文'}
                                onClick={() =>
                                  setRevealed((prev) => ({ ...prev, [item.key]: !plain }))
                                }
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                              >
                                {plain ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                              </button>
                            ) : null}
                            {item.configured && item.source === 'db' ? (
                              <button
                                type="button"
                                title="清除（回退到 .env）"
                                disabled={clearing}
                                onClick={() => handleClear(item.key)}
                                className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                              >
                                {clearing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </button>
                            ) : null}
                          </div>
                        </div>

                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg ? (
        <div
          className={`border-t px-5 py-2 text-[11px] font-medium ${
            msg.ok
              ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
              : 'border-rose-100 bg-rose-50 text-rose-800'
          }`}
        >
          {msg.text}
        </div>
      ) : null}
    </div>
  );
};
