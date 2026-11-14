import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copy,
  Download,
  FileJson,
  Music,
  Play,
  Plus,
  Shuffle,
  Sliders,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { midiToFreq, parseNoteSequence } from '../domain/melodies';
import {
  buildCustomVideoSpec,
  FIXTURE_BALL_SORT,
  FIXTURE_MELODY_BOUNCE,
  FIXTURE_ORBIT_SYNC,
  FIXTURE_PENDULUM_WAVE,
} from '../domain/templates';
import type { MelodyEntry, ValidationIssue, VideoSpec } from '../domain/types';
import type { StudioState } from '../types/ui';

interface LibraryViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

const INVALID_SAMPLE = {
  schema: 'specbatch/1',
  batch_id: 'invalid-demo-batch',
  generated_at: '2026-11-15T08:00:00Z',
  items: [
    {
      ...FIXTURE_MELODY_BOUNCE,
      spec_key: 'bad-params-demo-0001',
      scene: {
        ...FIXTURE_MELODY_BOUNCE.scene,
        params: {
          arena: { shape: 'invalid-octagon', size: 0.1 },
        },
      },
      audio: {
        ...FIXTURE_MELODY_BOUNCE.audio,
        music: {
          ...FIXTURE_MELODY_BOUNCE.audio.music!,
          melody_ref: { source: 'library', id: 'pd:missing-song' },
        },
      },
    },
  ],
};

const TEMPLATE_SCHEMAS = {
  'videospec/1': () => ({
    ...FIXTURE_MELODY_BOUNCE,
    spec_key: `custom-mb-${Date.now().toString().slice(-4)}`,
  }),
  'specbatch/1': () => ({
    schema: 'specbatch/1',
    batch_id: `batch-${new Date().toISOString().slice(0, 10)}`,
    generated_at: new Date().toISOString(),
    items: [
      {
        ...FIXTURE_PENDULUM_WAVE,
        spec_key: `pw-batch-${Date.now().toString().slice(-4)}`,
      },
    ],
  }),
  'melody/1': () => ({
    schema: 'melody/1',
    id: `original:custom-melody-${Date.now().toString().slice(-4)}`,
    title: 'Custom Arpeggio Loop',
    composer: 'Original Studio',
    death_year: null,
    source_url: 'internal://studio-composer',
    license: 'original',
    key: 'C major',
    tempo_bpm: 112,
    time_signature: '4/4',
    recognizability: 3,
    tags: ['custom', 'loop'],
    tracks: [
      {
        name: 'lead',
        notes: [
          { beat: 0, pitch: 60, dur: 1, vel: 90 },
          { beat: 1, pitch: 64, dur: 1, vel: 90 },
          { beat: 2, pitch: 67, dur: 1, vel: 90 },
          { beat: 3, pitch: 72, dur: 1, vel: 94 },
        ],
      },
    ],
    loopable: true,
  }),
  'ideabatch/1': () => ({
    schema: 'ideabatch/1',
    batch_id: `ideas-${new Date().toISOString().slice(0, 10)}`,
    items: [
      {
        idea_key: `idea-orbit-${Date.now().toString().slice(-4)}`,
        channel_slug: 'physics-music',
        mechanic: 'orbit-sync',
        arena: 'concentric-rings',
        rule: 'harmonic-align',
        music_piece: 'pd:canon-in-d',
        hook_style: 'countdown',
        hook_line: 'Wait for all 10 rings to align',
        title_candidates: ['10 Planetary Orbits Playing Canon in D'],
        payoff: 'All 10 orbital rings snap into resonance at 0:24.',
        series: null,
        novelty_notes: 'Concentric orbit-sync alignment synced to Canon in D instead of pendulum.',
      },
    ],
  }),
};

function previewMelodyWebAudio(notes: Array<{ beat: number; pitch: number; dur: number }>, bpm: number) {
  if (typeof window === 'undefined' || notes.length === 0) return;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  const secPerBeat = 60 / Math.max(40, Math.min(240, bpm || 110));
  const now = ctx.currentTime + 0.04;
  for (const n of notes.slice(0, 32)) {
    const start = now + n.beat * secPerBeat;
    const dur = Math.max(0.08, Math.min(1.5, n.dur * secPerBeat));
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(n.pitch), start);
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }
}

export const LibraryView: React.FC<LibraryViewProps> = ({ state, onRefresh, onNavigate }) => {
  const [subTab, setSubTab] = useState<'specs' | 'custom' | 'ideas' | 'import' | 'templates' | 'melodies'>('specs');
  const [jsonInput, setJsonInput] = useState(() =>
    JSON.stringify(
      {
        schema: 'specbatch/1',
        batch_id: `batch-${new Date().toISOString().slice(0, 10)}`,
        generated_at: new Date().toISOString(),
        items: [
          {
            ...FIXTURE_MELODY_BOUNCE,
            spec_key: `mb-demo-${Math.floor(1000 + Math.random() * 8999)}`,
            publish: {
              ...FIXTURE_MELODY_BOUNCE.publish,
              title: `Can You Name This Melody? ${Math.floor(10 + Math.random() * 80)} Balls Split`,
            },
          },
        ],
      },
      null,
      2
    )
  );
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [guideSchema, setGuideSchema] = useState<keyof typeof TEMPLATE_SCHEMAS>('videospec/1');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [aiCount, setAiCount] = useState(2);
  const [aiMessage, setAiMessage] = useState<string | null>(null);

  // Custom VideoSpec Builder state
  const [cTemplate, setCTemplate] = useState<'melody-bounce' | 'ball-sort' | 'pendulum-wave' | 'orbit-sync'>('pendulum-wave');
  const activeTemplateDef = useMemo(
    () => state.templates.find((t) => t.key === cTemplate) ?? state.templates[0],
    [state.templates, cTemplate]
  );
  const [cArena, setCArena] = useState('wave-beam');
  const [cRule, setCRule] = useState('harmonic-sweep');
  const [cMelodyId, setCMelodyId] = useState(state.melodies[0]?.id ?? 'pd:canon-in-d');
  const [cInstrument, setCInstrument] = useState('marimba');
  const [cTempoBpm, setCTempoBpm] = useState(108);
  const [cDuration, setCDuration] = useState(26);
  const [cSeed, setCSeed] = useState(() => Math.floor(100000 + Math.random() * 899999));
  const [cPalette, setCPalette] = useState<'neon' | 'pastel' | 'mono' | 'warm' | 'cool'>('neon');
  const [cHookStyle, setCHookStyle] = useState<VideoSpec['axes']['hook_style']>('countdown');
  const [cHookLine, setCHookLine] = useState('Wait for them to align');
  const [cTitle, setCTitle] = useState('15 Pendulums Drift Into Chaos Then Snap In Sync');
  const [cFirstComment, setCFirstComment] = useState('Which second did the wave lock in for you? 👇');
  const [cLoop, setCLoop] = useState(true);
  const [cMessage, setCMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Custom Melody Composer state
  const [melMode, setMelMode] = useState<'composer' | 'json'>('composer');
  const [melId, setMelId] = useState('original:custom-theme-01');
  const [melTitle, setMelTitle] = useState('');
  const [melComposer, setMelComposer] = useState('Original Studio');
  const [melLicense, setMelLicense] = useState<'original' | 'cc0' | 'public-domain'>('original');
  const [melDeathYear, setMelDeathYear] = useState(1890);
  const [melKey, setMelKey] = useState('C major');
  const [melBpm, setMelBpm] = useState(112);
  const [melRecog, setMelRecog] = useState(4);
  const [melSourceUrl, setMelSourceUrl] = useState('internal://studio-composer');
  const [melNoteText, setMelNoteText] = useState('C4:1, E4:1, G4:1, C5:1, B4:0.5, G4:0.5, E4:1, C4:2');
  const [melJsonText, setMelJsonText] = useState(() => JSON.stringify(TEMPLATE_SCHEMAS['melody/1'](), null, 2));
  const [melError, setMelError] = useState<string | null>(null);
  const [melSuccess, setMelSuccess] = useState<string | null>(null);

  const parsedComposerNotes = useMemo(() => parseNoteSequence(melNoteText), [melNoteText]);

  const handleTemplateSelect = (nextTemplate: typeof cTemplate) => {
    setCTemplate(nextTemplate);
    const def = state.templates.find((t) => t.key === nextTemplate);
    if (def) {
      setCArena(def.allowedAxes.arena[0] ?? 'hexagon');
      setCRule(def.allowedAxes.rule[0] ?? 'split-on-bounce');
    }
  };

  const handleCopyAndDownload = async (schemaKey: keyof typeof TEMPLATE_SCHEMAS, mode: 'copy' | 'download' | 'fill') => {
    const obj = TEMPLATE_SCHEMAS[schemaKey]();
    if ('channel_slug' in obj) {
      (obj as { channel_slug: string }).channel_slug = state.channel.slug;
    }
    const text = JSON.stringify(obj, null, 2);
    if (mode === 'fill') {
      setJsonInput(text);
      setImportStatus(`已将 ${schemaKey} 模板填入左侧编辑器`);
      return;
    }
    if (mode === 'copy') {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(schemaKey);
        setTimeout(() => setCopiedKey(null), 1500);
      } catch {
        // Ignore clipboard denial in headless
      }
      return;
    }
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schemaKey.replace('/', '-')}-template.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runImport = async (dryRun: boolean) => {
    setBusy(true);
    setImportStatus(null);
    setImportIssues([]);
    try {
      const parsed = JSON.parse(jsonInput) as Record<string, unknown>;
      if (parsed?.schema === 'melody/1') {
        if (dryRun) {
          setImportStatus('检测到 melody/1 旋律格式，点击「确认导入入库」即可直接存入旋律库。');
          return;
        }
        const res = await fetch('/api/melodies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed),
        });
        const data = await res.json();
        if (!res.ok) {
          setImportStatus(`旋律导入失败: ${data.error ?? '校验不通过'}`);
        } else {
          setImportStatus(`旋律导入成功：${data.melody?.title} (${data.melody?.id})`);
          await onRefresh();
          setSubTab('melodies');
        }
        return;
      }

      if (parsed?.schema === 'ideabatch/1') {
        if (dryRun) {
          setImportStatus(`检测到 ideabatch/1（共 ${Array.isArray(parsed.items) ? parsed.items.length : 0} 条选题），点击「确认导入入库」存入创意池。`);
          return;
        }
        const res = await fetch('/api/ideas/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: state.channel.id, payload: parsed }),
        });
        const data = await res.json();
        if (!res.ok) {
          setImportStatus(`创意导入失败: ${data.error ?? '校验不通过'}`);
        } else {
          setImportStatus(`创意导入完成：新增 ${data.addedCount ?? 0} 条选题至创意池`);
          await onRefresh();
          setSubTab('ideas');
        }
        return;
      }

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload: parsed,
          dry_run: dryRun,
          channel_slug: state.channel.slug,
        }),
      });
      const data = await res.json();
      setImportIssues(data.issues ?? []);
      if (dryRun) {
        setImportStatus(`试运行完成：通过 ${data.acceptedCount} 条，问题 ${data.issues?.length ?? 0} 条`);
      } else {
        setImportStatus(`导入完成：成功入库 ${data.acceptedCount} 条规格`);
        await onRefresh();
        if (data.acceptedCount > 0) {
          setSubTab('specs');
        }
      }
    } catch (err: unknown) {
      setImportStatus(`JSON 解析失败: ${err instanceof Error ? err.message : '格式错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCustomSpec = async (renderImmediately: boolean) => {
    setBusy(true);
    setCMessage(null);
    try {
      const spec = buildCustomVideoSpec({
        channelSlug: state.channel.slug,
        template: cTemplate,
        arena: cArena,
        rule: cRule,
        melodyId: cMelodyId,
        instrument: cInstrument,
        tempoBpm: cTempoBpm,
        durationSec: cDuration,
        seed: cSeed,
        paletteFamily: cPalette,
        hookStyle: cHookStyle,
        hookLine: cHookLine,
        title: cTitle,
        firstComment: cFirstComment,
        loopEnabled: cLoop,
      });

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: spec, dry_run: false, channel_slug: state.channel.slug }),
      });
      const data = await res.json();
      if (!res.ok || (data.acceptedCount ?? 0) === 0) {
        const firstErr = data.issues?.[0]?.message ?? data.error ?? '规格校验失败';
        setCMessage({ ok: false, text: firstErr });
        return;
      }
      const createdSpec = data.created?.[0];
      await onRefresh();
      if (renderImmediately && createdSpec?.id) {
        await fetch(`/api/specs/${createdSpec.id}/render`, { method: 'POST' });
        await onRefresh();
        onNavigate('studio');
      } else {
        setCMessage({ ok: true, text: `已生成并入库自定义规格：${spec.spec_key}` });
        setSubTab('specs');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAiGenerate = async () => {
    setBusy(true);
    setAiMessage(null);
    try {
      const res = await fetch('/api/ai/generate-specs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: state.channel.id, count: aiCount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiMessage(data.error ?? 'AI 生成失败');
      } else {
        setAiMessage(
          `已通过 ${data.model} 生成并入库 ${data.created?.length ?? 0} 条差异化 Spec（预估花费 $${Number(data.cost_usd ?? 0).toFixed(4)}）`
        );
        await onRefresh();
      }
    } catch {
      setAiMessage('AI 接口请求失败');
    } finally {
      setBusy(false);
    }
  };

  const handleTriggerRender = async (specId: string) => {
    setBusy(true);
    try {
      await fetch(`/api/specs/${specId}/render`, { method: 'POST' });
      await onRefresh();
      onNavigate('studio');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSpec = async (specId: string, title: string) => {
    const ok = window.confirm(
      `确定删除创意「${title}」？\n\n将同时删除：\n· 该创意的全部渲染记录\n· 磁盘上的 MP4 成品与缓存文件\n· 关联的审核、视频、评论条目\n\n此操作不可撤销。`
    );
    if (!ok) return;
    setBusy(true);
    setAiMessage(null);
    try {
      const res = await fetch(`/api/specs/${specId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setAiMessage(data.error ?? '删除失败');
      } else {
        const mb = ((data.freedBytes ?? 0) / 1048576).toFixed(1);
        setAiMessage(
          `已删除创意「${title}」：清理 ${data.deletedFiles ?? 0} 个文件（释放 ${mb} MB）` +
            (data.removedRecords?.renders ? `，${data.removedRecords.renders} 条渲染记录` : '')
        );
        await onRefresh();
      }
    } catch (err) {
      setAiMessage(err instanceof Error ? err.message : '网络错误');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteIdea = async (ideaId: string, text: string) => {
    const ok = window.confirm(`确定删除这条创意？\n\n${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/ideas/${ideaId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) setAiMessage(data.error ?? '删除失败');
      else {
        setAiMessage('创意已从创意池删除');
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePurgeSeedData = async () => {
    const ok = window.confirm(
      '将删除工作台内置的 5 条示例创意（demo fixture）及其全部渲染产物、磁盘文件。\n\n你自己导入或 AI 生成的创意不受影响。确定继续？'
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch('/api/maintenance/purge-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) setAiMessage(data.error ?? '清理失败');
      else {
        const mb = ((data.freedBytes ?? 0) / 1048576).toFixed(1);
        setAiMessage(
          `已清理内置示例：${data.purgedSpecs} 条创意、${data.purgedIdeas} 条创意池条目，释放 ${mb} MB`
        );
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleExpandIdea = async (ideaId: string) => {
    setBusy(true);
    setAiMessage(null);
    try {
      const res = await fetch(`/api/ideas/${ideaId}/expand`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setAiMessage(data.error ?? '展开创意失败');
      } else {
        setAiMessage(`已将创意展开为完整 VideoSpec: ${data.spec?.spec?.spec_key}`);
        await onRefresh();
        setSubTab('specs');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddMelody = async (e: React.FormEvent) => {
    e.preventDefault();
    setMelError(null);
    setMelSuccess(null);

    let payload: MelodyEntry;
    if (melMode === 'json') {
      try {
        payload = JSON.parse(melJsonText) as MelodyEntry;
      } catch {
        setMelError('melody/1 JSON 格式无效，请检查语法');
        return;
      }
    } else {
      if (parsedComposerNotes.error) {
        setMelError(parsedComposerNotes.error);
        return;
      }
      payload = {
        schema: 'melody/1',
        id: melId.trim(),
        title: melTitle.trim() || 'Untitled Custom Melody',
        composer: melComposer.trim() || 'Original Studio',
        death_year: melLicense === 'public-domain' ? Number(melDeathYear) : null,
        source_url: melSourceUrl.trim() || 'internal://studio-composer',
        license: melLicense,
        key: melKey.trim() || 'C major',
        tempo_bpm: Number(melBpm) || 112,
        time_signature: '4/4',
        recognizability: Number(melRecog) || 3,
        tags: ['custom'],
        tracks: [{ name: 'lead', notes: parsedComposerNotes.notes }],
        loopable: true,
      };
    }

    const res = await fetch('/api/melodies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setMelError(data.error ?? '添加旋律失败');
      return;
    }
    setMelTitle('');
    setMelId(`original:custom-${Date.now().toString().slice(-4)}`);
    setMelSuccess(`已保存旋律「${data.melody?.title}」(${data.melody?.id})`);
    await onRefresh();
  };

  return (
    <div className="space-y-5">
      {/* Sub-navigation Segmented Control + AI Generator Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          {[
            { id: 'specs', label: `规格库 (${state.specs.length})` },
            { id: 'custom', label: '自定义制作' },
            { id: 'ideas', label: `创意池 (${state.ideas.filter((i) => i.status === 'pending').length})` },
            { id: 'import', label: '导入 JSON 与模板' },
            { id: 'templates', label: `模板目录 (${state.templates.length})` },
            { id: 'melodies', label: `旋律库 (${state.melodies.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as typeof subTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="AI 生成条数"
            value={aiCount}
            onChange={(e) => setAiCount(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700"
          >
            <option value={1}>生成 1 条</option>
            <option value={2}>生成 2 条</option>
            <option value={3}>生成 3 条</option>
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={handleAiGenerate}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 差异化补货
          </button>
        </div>
      </div>

      {aiMessage && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-700">
          {aiMessage}
        </div>
      )}

      {/* Specs Table */}
      {subTab === 'specs' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <div className="text-xs text-slate-600">
              共 <span className="font-semibold text-slate-900">{state.specs.length}</span> 条创意
              <span className="ml-2 text-slate-400">删除创意会一并清理渲染记录与磁盘上的 MP4 / 缓存</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handlePurgeSeedData}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
            >
              <Trash2 className="h-3 w-3" />
              清理内置示例数据
            </button>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">标题 / Spec Key</th>
                <th className="px-4 py-3">结构轴 (模板 · 场地 · 规则)</th>
                <th className="px-4 py-3">旋律</th>
                <th className="px-4 py-3">钩子</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.specs.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{item.spec.publish.title}</div>
                    <div className="mt-0.5 font-mono text-xs text-slate-500">
                      {item.spec.spec_key} · {item.spec.format.duration_sec}s
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    {item.spec.axes.mechanic} · {item.spec.axes.arena} · {item.spec.axes.rule}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.spec.axes.music_piece}</td>
                  <td className="px-4 py-3 text-xs text-slate-700">
                    <div>{item.spec.concept.hook_line}</div>
                    <div className="text-slate-400">{item.spec.axes.hook_style}</div>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-800 whitespace-nowrap">{item.status}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleTriggerRender(item.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Play className="h-3 w-3" />
                      渲染
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDeleteSpec(item.id, item.spec.publish.title)}
                      title="删除创意及其渲染产物与磁盘文件"
                      className="ml-1.5 inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {state.specs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    当前频道暂无 VideoSpec，请点击「自定义制作」、「导入 JSON 与模板」或「AI 差异化补货」。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Custom Visual VideoSpec Builder */}
      {subTab === 'custom' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Sliders className="h-4 w-4 text-slate-500" />
                自定义视频与音乐制作台（零 JSON 手写）
              </div>
              <p className="mt-1 text-xs text-slate-500">
                直接选择物理模板、场地形状、物理规则、旋律曲目、音色与文案钩子，系统自动生成严格合标的可渲染 VideoSpec 并同步生成预览/MP4。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSubTab('melodies')}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Music className="h-3.5 w-3.5" />
              先去旋律库自编音乐
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div>
              <label htmlFor="custom-template" className="block font-medium text-slate-700">
                物理模板 (Mechanic)
              </label>
              <select
                id="custom-template"
                value={cTemplate}
                onChange={(e) => handleTemplateSelect(e.target.value as typeof cTemplate)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                {state.templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} ({t.key})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="custom-arena" className="block font-medium text-slate-700">
                场地形状 (Arena)
              </label>
              <select
                id="custom-arena"
                value={cArena}
                onChange={(e) => setCArena(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
              >
                {(activeTemplateDef?.allowedAxes.arena ?? ['hexagon']).map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="custom-rule" className="block font-medium text-slate-700">
                物理规则 (Rule)
              </label>
              <select
                id="custom-rule"
                value={cRule}
                onChange={(e) => setCRule(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
              >
                {(activeTemplateDef?.allowedAxes.rule ?? ['split-on-bounce']).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="custom-melody" className="block font-medium text-slate-700">
                绑定旋律曲目
              </label>
              <select
                id="custom-melody"
                value={cMelodyId}
                onChange={(e) => {
                  setCMelodyId(e.target.value);
                  const found = state.melodies.find((m) => m.id === e.target.value);
                  if (found) setCTempoBpm(found.tempo_bpm);
                }}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                {state.melodies.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title} ({m.tempo_bpm} BPM · {m.license})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="custom-instrument" className="block font-medium text-slate-700">
                合成音色 (Instrument)
              </label>
              <select
                id="custom-instrument"
                value={cInstrument}
                onChange={(e) => setCInstrument(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                <option value="marimba">Marimba (马林巴琴)</option>
                <option value="piano">Piano (钢琴)</option>
                <option value="kalimba">Kalimba (卡林巴拇指琴)</option>
                <option value="celesta">Celesta (钢片琴)</option>
                <option value="harp">Harp (竖琴)</option>
                <option value="bell">Bell (清脆风铃)</option>
                <option value="music-box">Music Box (八音盒)</option>
              </select>
            </div>

            <div>
              <label htmlFor="custom-palette" className="block font-medium text-slate-700">
                视觉配色 (Palette)
              </label>
              <select
                id="custom-palette"
                value={cPalette}
                onChange={(e) => setCPalette(e.target.value as typeof cPalette)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                <option value="neon">Neon (霓虹荧光 · 高对比)</option>
                <option value="cool">Cool (深海蓝紫)</option>
                <option value="pastel">Pastel (柔和马卡龙)</option>
                <option value="warm">Warm (暖阳烈焰)</option>
                <option value="mono">Mono (极简黑白)</option>
              </select>
            </div>

            <div>
              <label htmlFor="custom-duration" className="block font-medium text-slate-700">
                视频时长 (秒, 8–180)
              </label>
              <input
                id="custom-duration"
                type="number"
                min={8}
                max={180}
                value={cDuration}
                onChange={(e) => setCDuration(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono tabular-nums"
              />
            </div>

            <div>
              <label htmlFor="custom-seed" className="block font-medium text-slate-700">
                物理随机种子 (Seed)
              </label>
              <div className="mt-1 flex gap-1.5">
                <input
                  id="custom-seed"
                  type="number"
                  min={1}
                  value={cSeed}
                  onChange={(e) => setCSeed(Number(e.target.value))}
                  className="w-full rounded border border-slate-200 px-3 py-2 font-mono tabular-nums"
                />
                <button
                  type="button"
                  aria-label="随机生成种子"
                  onClick={() => setCSeed(Math.floor(100000 + Math.random() * 899999))}
                  className="rounded border border-slate-200 px-2.5 py-2 text-slate-700 hover:bg-slate-50"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
            <div>
              <label htmlFor="custom-hook-style" className="block font-medium text-slate-700">
                钩子类型 (Hook Style)
              </label>
              <select
                id="custom-hook-style"
                value={cHookStyle}
                onChange={(e) => setCHookStyle(e.target.value as typeof cHookStyle)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                <option value="countdown">countdown (倒计时对齐)</option>
                <option value="mystery">mystery (猜歌名悬念)</option>
                <option value="prediction">prediction (猜赢家预测)</option>
                <option value="escalation">escalation (指数升级)</option>
                <option value="contrast">contrast (反差对比)</option>
              </select>
            </div>
            <div>
              <label htmlFor="custom-bpm" className="block font-medium text-slate-700">
                音乐速度 (BPM, 40–240)
              </label>
              <input
                id="custom-bpm"
                type="number"
                min={40}
                max={240}
                value={cTempoBpm}
                onChange={(e) => setCTempoBpm(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono tabular-nums"
              />
            </div>
            <div className="flex items-end">
              <label className="flex w-full items-center gap-2 rounded border border-slate-200 px-3 py-2 text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cLoop}
                  onChange={(e) => setCLoop(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <span>启用无缝循环结尾 (Loop)</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 text-xs">
            <div>
              <label htmlFor="custom-hook-line" className="block font-medium text-slate-700">
                首秒屏幕钩子文案 (建议 ≤ 6 词)
              </label>
              <input
                id="custom-hook-line"
                type="text"
                maxLength={80}
                value={cHookLine}
                onChange={(e) => setCHookLine(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="custom-title" className="block font-medium text-slate-700">
                YouTube 视频标题 (≤ 100 字符，无 # 标签)
              </label>
              <input
                id="custom-title"
                type="text"
                maxLength={100}
                value={cTitle}
                onChange={(e) => setCTitle(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              />
            </div>
            <div>
              <label htmlFor="custom-comment" className="block font-medium text-slate-700">
                发布后自动置顶首评 (≤ 200 字符)
              </label>
              <input
                id="custom-comment"
                type="text"
                maxLength={200}
                value={cFirstComment}
                onChange={(e) => setCFirstComment(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              />
            </div>
          </div>

          {cMessage && (
            <div
              className={`rounded border px-3 py-2 text-xs font-medium ${
                cMessage.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              {cMessage.text}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSaveCustomSpec(false)}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              仅生成并保存 Spec
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSaveCustomSpec(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              保存并立即渲染预览
            </button>
          </div>
        </div>
      )}

      {/* Idea Pool (ideabatch/1) */}
      {subTab === 'ideas' && (
        <div className="space-y-3">
          {state.ideas.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                  <span>{item.idea.idea_key}</span>
                  <span>·</span>
                  <span>{item.idea.mechanic} / {item.idea.arena} / {item.idea.rule}</span>
                  <span>·</span>
                  <span>{item.idea.music_piece}</span>
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {item.idea.title_candidates[0] ?? item.idea.hook_line}
                </div>
                <p className="text-xs text-slate-600">{item.idea.novelty_notes}</p>
              </div>
              <div className="shrink-0">
                {item.status === 'pending' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleExpandIdea(item.id)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    展开为 VideoSpec
                  </button>
                ) : (
                  <span className="font-mono text-xs text-emerald-700">已展开 ({item.spec_id})</span>
                )}
              </div>
            </div>
          ))}
          {state.ideas.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              创意池为空，可前往「情报与趋势」生成 ideabatch 选题。
            </div>
          )}
        </div>
      )}

      {/* JSON Importer + Templates & Constraints Guide */}
      {subTab === 'import' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileJson className="h-4 w-4 text-slate-500" />
                  导入 JSON（支持 videospec/1 · specbatch/1 · melody/1 · ideabatch/1）
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setJsonInput(
                        JSON.stringify(
                          {
                            ...FIXTURE_MELODY_BOUNCE,
                            spec_key: `mb-fixture-${Date.now().toString().slice(-4)}`,
                            channel_slug: state.channel.slug,
                            publish: {
                              ...FIXTURE_MELODY_BOUNCE.publish,
                              title: `Hexagon Split Canon #${Date.now().toString().slice(-4)}`,
                            },
                          },
                          null,
                          2
                        )
                      )
                    }
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    melody-bounce
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setJsonInput(
                        JSON.stringify(
                          {
                            ...FIXTURE_BALL_SORT,
                            spec_key: `bs-fixture-${Date.now().toString().slice(-4)}`,
                            channel_slug: state.channel.slug,
                            publish: {
                              ...FIXTURE_BALL_SORT.publish,
                              title: `Color Filter Ball Sort #${Date.now().toString().slice(-4)}`,
                            },
                          },
                          null,
                          2
                        )
                      )
                    }
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    ball-sort
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setJsonInput(
                        JSON.stringify(
                          {
                            ...FIXTURE_PENDULUM_WAVE,
                            spec_key: `pw-fixture-${Date.now().toString().slice(-4)}`,
                            channel_slug: state.channel.slug,
                            publish: {
                              ...FIXTURE_PENDULUM_WAVE.publish,
                              title: `14 Pendulum Harmonic Wave #${Date.now().toString().slice(-4)}`,
                            },
                          },
                          null,
                          2
                        )
                      )
                    }
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    pendulum-wave
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setJsonInput(
                        JSON.stringify(
                          {
                            ...FIXTURE_ORBIT_SYNC,
                            spec_key: `os-fixture-${Date.now().toString().slice(-4)}`,
                            channel_slug: state.channel.slug,
                            publish: {
                              ...FIXTURE_ORBIT_SYNC.publish,
                              title: `8-Ring Orbit Phase Sync #${Date.now().toString().slice(-4)}`,
                            },
                          },
                          null,
                          2
                        )
                      )
                    }
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    orbit-sync
                  </button>
                  <button
                    type="button"
                    onClick={() => setJsonInput(JSON.stringify(INVALID_SAMPLE, null, 2))}
                    className="rounded border border-slate-200 px-2.5 py-1 text-xs text-rose-700 hover:bg-rose-50"
                  >
                    错误样例
                  </button>
                </div>
              </div>

              <textarea
                aria-label="VideoSpec JSON 输入框"
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
                rows={15}
                className="w-full rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
              />

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runImport(true)}
                  className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  试运行校验 (Dry Run)
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runImport(false)}
                  className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                >
                  确认导入入库
                </button>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-slate-900">校验结果与错误路径</h3>
              {importStatus && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800">
                  {importStatus}
                </div>
              )}
              {importIssues.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  点击「试运行校验」检查 schema、模板参数、旋律版权与重复哈希。
                </div>
              ) : (
                <div className="space-y-2 max-h-[380px] overflow-y-auto">
                  {importIssues.map((issue, idx) => (
                    <div
                      key={idx}
                      className={`rounded-md border p-3 text-xs ${
                        issue.level === 'error'
                          ? 'border-rose-200 bg-rose-50/50 text-rose-900'
                          : 'border-amber-200 bg-amber-50/50 text-amber-900'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 font-mono font-semibold">
                        {issue.level === 'error' ? (
                          <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-amber-600" />
                        )}
                        <span>{issue.code}</span>
                        <span className="text-slate-500">·</span>
                        <span className="truncate">{issue.path}</span>
                      </div>
                      <div className="mt-1">{issue.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Import Template & Constraints Specification Card */}
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <BookOpen className="h-4 w-4 text-slate-500" />
                标准导入模板下载与固定字段约束说明
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['videospec/1', 'specbatch/1', 'melody/1', 'ideabatch/1'] as const).map((sk) => (
                  <button
                    key={sk}
                    type="button"
                    onClick={() => setGuideSchema(sk)}
                    className={`rounded border px-2.5 py-1 font-mono text-xs ${
                      guideSchema === sk
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {sk}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <span className="font-mono text-slate-700">当前查看标准模板：{guideSchema}</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyAndDownload(guideSchema, 'fill')}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
                >
                  填入上方编辑器
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyAndDownload(guideSchema, 'copy')}
                  className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-800 hover:bg-slate-100"
                >
                  <Copy className="h-3 w-3" />
                  {copiedKey === guideSchema ? '已复制' : '复制模板'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyAndDownload(guideSchema, 'download')}
                  className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 font-medium text-white hover:bg-slate-800"
                >
                  <Download className="h-3 w-3" />
                  下载 .json
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-3 py-2">固定字段路径</th>
                      <th className="px-3 py-2">约束规则与枚举值</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">schema</td>
                      <td className="px-3 py-2">固定为 videospec/1、specbatch/1、melody/1 或 ideabatch/1</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">spec_key</td>
                      <td className="px-3 py-2">6–80 位小写字母/数字/连字符 ^[a-z0-9-]+$，频道内唯一</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">format</td>
                      <td className="px-3 py-2">aspect 仅 9:16 或 1:1；fps 仅 30/60；duration_sec 8–180</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">scene.template</td>
                      <td className="px-3 py-2">melody-bounce | ball-sort | pendulum-wave | orbit-sync</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">concept.novelty_notes</td>
                      <td className="px-3 py-2">至少 20 字符，须说明结构/规则/音乐实质差异</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">publish.title / tags</td>
                      <td className="px-3 py-2">标题 ≤ 100 字符（无 # 标签），标签总字符 ≤ 500</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-medium">melody.license</td>
                      <td className="px-3 py-2">仅允许 public-domain（逝世 ≤ 1950）/ cc0 / original，音符 ≥ 4</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                      <th className="px-3 py-2">校验码</th>
                      <th className="px-3 py-2">含义与排查说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E001 / E002</td>
                      <td className="px-3 py-2">JSON 缺失必填字段、类型错误或 schema 版本不支持</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E010 / E011</td>
                      <td className="px-3 py-2">模板未注册、版本号不匹配，或 scene.params 越界</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E020</td>
                      <td className="px-3 py-2">分辨率/帧率/时长非法（如 9:16 竖屏必须 height &gt; width）</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E030 / E031</td>
                      <td className="px-3 py-2">曲目不存在于旋律库，或旋律版权类型不合规</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E040–E042</td>
                      <td className="px-3 py-2">标题/标签超限，或与库内 spec_hash / spec_key 重复</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-rose-700">E050</td>
                      <td className="px-3 py-2">channel_slug 在当前工作台不存在</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-mono font-semibold text-amber-700">W102–W105</td>
                      <td className="px-3 py-2">警告：Hook 超过 6 词、缺少首秒文本、缺结尾卡或差异说明笼统</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Registry */}
      {subTab === 'templates' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {state.templates.map((t) => (
            <div key={t.key} className="rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-semibold text-slate-900">{t.name}</h3>
                <span className="font-mono text-xs text-slate-500">
                  {t.key}@{t.version}
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{t.description}</p>
              <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <div>可选场地: {t.allowedAxes.arena.join(' / ')}</div>
                <div>可选规则: {t.allowedAxes.rule.join(' / ')}</div>
                <div>触发事件: {t.events.join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Melody Library + Real Custom Note Composer & Audio Audition */}
      {subTab === 'melodies' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto lg:col-span-3">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-3 py-2.5 sm:px-4">曲目 ID / 名称</th>
                  <th className="hidden px-4 py-2.5 sm:table-cell">作曲者 (逝世年份)</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">授权</th>
                  <th className="px-3 py-2.5 text-right sm:px-4">音符 / BPM / 试听</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {state.melodies.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 sm:px-4">
                      <div className="font-medium text-slate-900">{m.title}</div>
                      <div className="font-mono text-slate-500">{m.id}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500 sm:hidden">
                        {m.composer}
                        {m.death_year ? ` (${m.death_year})` : ''} · <span className="text-emerald-700">{m.license}</span>
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-700 sm:table-cell">
                      {m.composer} {m.death_year ? `(${m.death_year})` : ''}
                    </td>
                    <td className="hidden px-4 py-2.5 font-mono text-emerald-700 md:table-cell">{m.license}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap sm:px-4">
                      <div className="inline-flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <span>
                          {m.tracks[0]?.notes.length ?? 0} 音 · {m.tempo_bpm} BPM
                        </span>
                        <button
                          type="button"
                          aria-label={`试听 ${m.title}`}
                          onClick={() => previewMelodyWebAudio(m.tracks[0]?.notes ?? [], m.tempo_bpm)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-800 hover:bg-slate-100"
                        >
                          <Volume2 className="h-3 w-3" />
                          试听
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form onSubmit={handleAddMelody} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Music className="h-4 w-4 text-slate-500" />
                自定义创建 / 导入旋律
              </div>
              <div className="inline-flex rounded border border-slate-200 bg-slate-100 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => setMelMode('composer')}
                  className={`rounded px-2 py-1 font-medium ${melMode === 'composer' ? 'bg-white text-slate-900' : 'text-slate-600'}`}
                >
                  音符编写
                </button>
                <button
                  type="button"
                  onClick={() => setMelMode('json')}
                  className={`rounded px-2 py-1 font-medium ${melMode === 'json' ? 'bg-white text-slate-900' : 'text-slate-600'}`}
                >
                  JSON 导入
                </button>
              </div>
            </div>

            {melMode === 'composer' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="mel-id" className="block text-xs font-medium text-slate-700">
                      旋律 ID
                    </label>
                    <input
                      id="mel-id"
                      type="text"
                      value={melId}
                      onChange={(e) => setMelId(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="mel-title" className="block text-xs font-medium text-slate-700">
                      曲目名称
                    </label>
                    <input
                      id="mel-title"
                      type="text"
                      value={melTitle}
                      onChange={(e) => setMelTitle(e.target.value)}
                      placeholder="例如: Custom Synth Arp"
                      required
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="mel-composer" className="block text-xs font-medium text-slate-700">
                      作曲者 / 来源
                    </label>
                    <input
                      id="mel-composer"
                      type="text"
                      value={melComposer}
                      onChange={(e) => setMelComposer(e.target.value)}
                      required
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="mel-license" className="block text-xs font-medium text-slate-700">
                      授权类型
                    </label>
                    <select
                      id="mel-license"
                      value={melLicense}
                      onChange={(e) => setMelLicense(e.target.value as typeof melLicense)}
                      className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs"
                    >
                      <option value="original">original (自创/程序生成)</option>
                      <option value="cc0">cc0 (无版权)</option>
                      <option value="public-domain">public-domain (逝世 ≤ 1950)</option>
                    </select>
                  </div>
                </div>

                {melLicense === 'public-domain' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="mel-death-year" className="block text-xs font-medium text-slate-700">
                        作曲者逝世年份 (≤ 1950)
                      </label>
                      <input
                        id="mel-death-year"
                        type="number"
                        max={1950}
                        value={melDeathYear}
                        onChange={(e) => setMelDeathYear(Number(e.target.value))}
                        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="mel-source-url" className="block text-xs font-medium text-slate-700">
                        公版乐谱来源 URL
                      </label>
                      <input
                        id="mel-source-url"
                        type="text"
                        value={melSourceUrl}
                        onChange={(e) => setMelSourceUrl(e.target.value)}
                        className="mt-1 w-full rounded-md border border-slate-200 px-3 py-1.5 font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label htmlFor="mel-key" className="block text-xs font-medium text-slate-700">
                      调性
                    </label>
                    <input
                      id="mel-key"
                      type="text"
                      value={melKey}
                      onChange={(e) => setMelKey(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="mel-bpm" className="block text-xs font-medium text-slate-700">
                      BPM
                    </label>
                    <input
                      id="mel-bpm"
                      type="number"
                      min={40}
                      max={240}
                      value={melBpm}
                      onChange={(e) => setMelBpm(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="mel-recog" className="block text-xs font-medium text-slate-700">
                      识别度 (1–5)
                    </label>
                    <input
                      id="mel-recog"
                      type="number"
                      min={1}
                      max={5}
                      value={melRecog}
                      onChange={(e) => setMelRecog(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="mel-notes" className="block text-xs font-medium text-slate-700">
                      音符序列（音名或 MIDI + 拍数，如 C4:1, E4:1, G4:0.5）
                    </label>
                    <button
                      type="button"
                      disabled={Boolean(parsedComposerNotes.error)}
                      onClick={() => previewMelodyWebAudio(parsedComposerNotes.notes, melBpm)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 disabled:opacity-40"
                    >
                      <Volume2 className="h-3 w-3" />
                      试听旋律
                    </button>
                  </div>
                  <textarea
                    id="mel-notes"
                    rows={3}
                    value={melNoteText}
                    onChange={(e) => setMelNoteText(e.target.value)}
                    placeholder="C4:1, E4:1, G4:1, C5:2 或 60:1, 64:1, 67:1, 72:2"
                    className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs"
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    {parsedComposerNotes.error ? (
                      <span className="text-rose-600">{parsedComposerNotes.error}</span>
                    ) : (
                      <span>
                        已解析 {parsedComposerNotes.notes.length} 个音符 · 总拍数{' '}
                        {parsedComposerNotes.notes.reduce((sum, n) => sum + n.dur, 0).toFixed(1)} 拍
                      </span>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label htmlFor="mel-json-input" className="block text-xs font-medium text-slate-700">
                  粘贴完整 melody/1 JSON（至少 4 个单调递增 beat 音符）
                </label>
                <textarea
                  id="mel-json-input"
                  rows={12}
                  value={melJsonText}
                  onChange={(e) => setMelJsonText(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px]"
                />
              </div>
            )}

            {melError && <div className="text-xs text-rose-600">{melError}</div>}
            {melSuccess && <div className="text-xs text-emerald-700 font-medium">{melSuccess}</div>}

            <button
              type="submit"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              添加到旋律库
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
