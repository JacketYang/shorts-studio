import React from 'react';
import { Shuffle, SlidersHorizontal } from 'lucide-react';
import type { MelodyEntry } from '../domain/types';
import { SONGS, songById } from '../workbench/catalog/songs';
import {
  clampTempoScale,
  MELODY_ENGINES,
  SCALE_OPTIONS,
  TEMPO_SCALE_PRESETS,
  VOICE_OPTIONS,
} from '../workbench/engine/presets';
import { THEMES } from '../workbench/engine/util';

interface WorkbenchTunerProps {
  mode: 'workbench';
  engine: string;
  params: Record<string, unknown>;
  theme: number;
  seed: number;
  durationSec: number;
  hookLine?: string;
  title?: string;
  showTextFields?: boolean;
  showThemePicker?: boolean;
  compact?: boolean;
  onChangeParams: (patch: Record<string, unknown>) => void;
  onChangeTheme?: (nextTheme: number) => void;
  onChangeSeed?: (nextSeed: number) => void;
  onChangeHookLine?: (val: string) => void;
  onChangeTitle?: (val: string) => void;
}

interface NativeTunerProps {
  mode: 'native';
  melodies: MelodyEntry[];
  melodyId: string;
  tempoBpm: number;
  motionSpeedScale: number;
  instrument: string;
  transpose: number;
  reverb: number;
  paletteFamily: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
  seed: number;
  hookLine?: string;
  title?: string;
  durationSec: number;
  onChangeNative: (patch: {
    melodyId?: string;
    tempoBpm?: number;
    motionSpeedScale?: number;
    instrument?: string;
    transpose?: number;
    reverb?: number;
    paletteFamily?: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
    seed?: number;
    hookLine?: string;
    title?: string;
  }) => void;
}

export type CreativeAudioTunerProps = WorkbenchTunerProps | NativeTunerProps;

const PALETTE_FAMILY_OPTIONS: Array<{ id: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool'; label: string }> = [
  { id: 'neon', label: '霓虹高对比 (Neon)' },
  { id: 'pastel', label: '柔和纸感粉彩 (Pastel)' },
  { id: 'cool', label: '冷静科技蓝绿 (Cool)' },
  { id: 'warm', label: '暖曜黑金琥珀 (Warm)' },
  { id: 'mono', label: '极简黑白单色 (Mono)' },
];

export const CreativeAudioTuner: React.FC<CreativeAudioTunerProps> = (props) => {
  if (props.mode === 'workbench') {
    const {
      engine,
      params,
      theme,
      seed,
      durationSec,
      hookLine = '',
      title = '',
      showTextFields = true,
      showThemePicker = true,
      compact = false,
      onChangeParams,
      onChangeTheme,
      onChangeSeed,
      onChangeHookLine,
      onChangeTitle,
    } = props;

    const isMelodyEngine = MELODY_ENGINES.has(engine);
    const tempoScale = clampTempoScale(params.tempoScale);
    const curSongObj = params.song as { id?: string } | undefined;
    const songId = typeof curSongObj?.id === 'string' ? curSongObj.id : 'canon';
    const voice = typeof params.voice === 'string' ? params.voice : 'marimba';
    const scaleIdx = typeof params.scale === 'number' ? ((params.scale % SCALE_OPTIONS.length) + SCALE_OPTIONS.length) % SCALE_OPTIONS.length : 0;
    const transpose = typeof params.transpose === 'number' ? params.transpose : 0;
    const echoOn = typeof params.echo === 'boolean' ? params.echo : engine !== 'pi';

    const handleRandomSong = () => {
      const candidates = SONGS.filter((s) => s.id !== songId);
      const picked = candidates[Math.floor(Math.random() * candidates.length)] ?? SONGS[0];
      onChangeParams({ song: picked });
    };

    const handleRerollSeed = () => {
      const next = Math.floor(1000 + Math.random() * 899999);
      onChangeSeed?.(next);
    };

    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/75 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600" />
            <span>音乐速度 / 选曲 / 音色与画风微调</span>
          </div>
          <span className="font-mono text-[11px] text-slate-600 tabular-nums">
            预览时长 {durationSec.toFixed(1)}s · 倍速 {tempoScale.toFixed(2)}×
          </span>
        </div>

        {/* Speed / Tempo Scale */}
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={`wb-tempo-${engine}`} className="font-medium text-slate-700">
              音乐与动画速度倍率
            </label>
            <div className="flex flex-wrap items-center gap-1">
              {TEMPO_SCALE_PRESETS.map((preset) => {
                const active = Math.abs(tempoScale - preset) < 0.02;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onChangeParams({ tempoScale: preset })}
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] tabular-nums transition-colors ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {preset}×
                  </button>
                );
              })}
            </div>
          </div>
          <input
            id={`wb-tempo-${engine}`}
            type="range"
            min={0.6}
            max={2.2}
            step={0.05}
            value={tempoScale}
            onChange={(e) => onChangeParams({ tempoScale: Number(e.target.value) })}
            className="h-1.5 w-full cursor-pointer accent-slate-900"
          />
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>0.6× 舒缓</span>
            <span>1.0× 原速</span>
            <span>1.5× 紧凑爽感</span>
            <span>2.2× 极速</span>
          </div>
        </div>

        {/* Song / Scale & Voice */}
        <div className={`grid grid-cols-1 gap-2.5 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2'}`}>
          {isMelodyEngine ? (
            <div>
              <label htmlFor={`wb-song-${engine}`} className="block font-medium text-slate-700">
                更换公版曲目 (31 首)
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <select
                  id={`wb-song-${engine}`}
                  value={songId}
                  onChange={(e) => onChangeParams({ song: songById(e.target.value) })}
                  className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  {SONGS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleRandomSong}
                  title="随机切换一首曲目"
                  aria-label="随机换曲"
                  className="shrink-0 rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor={`wb-scale-${engine}`} className="block font-medium text-slate-700">
                调式音阶 (Scale)
              </label>
              <select
                id={`wb-scale-${engine}`}
                value={scaleIdx}
                onChange={(e) => onChangeParams({ scale: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {SCALE_OPTIONS.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.labelZh}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor={`wb-voice-${engine}`} className="block font-medium text-slate-700">
              乐器音色 (Voice)
            </label>
            <select
              id={`wb-voice-${engine}`}
              value={voice}
              onChange={(e) => onChangeParams({ voice: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              {VOICE_OPTIONS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.labelZh}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Transpose + Echo + Seed */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 items-end">
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={`wb-transpose-${engine}`} className="font-medium text-slate-700">
                半音移调
              </label>
              <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                {transpose > 0 ? `+${transpose}` : transpose === 0 ? '原调 (0)' : transpose} st
              </span>
            </div>
            <input
              id={`wb-transpose-${engine}`}
              type="range"
              min={-7}
              max={7}
              step={1}
              value={transpose}
              onChange={(e) => onChangeParams({ transpose: Number(e.target.value) })}
              className="mt-2 h-1.5 w-full cursor-pointer accent-slate-900"
            />
          </div>

          <label className="inline-flex h-[32px] cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-slate-700">
            <input
              type="checkbox"
              checked={echoOn}
              onChange={(e) => onChangeParams({ echo: e.target.checked })}
              className="h-3.5 w-3.5 accent-slate-900"
            />
            <span>立体声回响 (Echo)</span>
          </label>

          {onChangeSeed && (
            <div>
              <label htmlFor={`wb-seed-${engine}`} className="block font-medium text-slate-700">
                物理随机种子
              </label>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  id={`wb-seed-${engine}`}
                  type="number"
                  min={1}
                  value={seed}
                  onChange={(e) => onChangeSeed(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                  className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleRerollSeed}
                  title="生成新种子"
                  aria-label="随机新种子"
                  className="shrink-0 rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Theme Picker */}
        {showThemePicker && onChangeTheme && (
          <div>
            <label htmlFor={`wb-theme-${engine}`} className="block font-medium text-slate-700 mb-1">
              画风与视觉配色主题
            </label>
            <div className="flex flex-wrap gap-1.5" id={`wb-theme-${engine}`}>
              {THEMES.map((th, idx) => {
                const active = ((theme % THEMES.length) + THEMES.length) % THEMES.length === idx;
                return (
                  <button
                    key={th.name}
                    type="button"
                    onClick={() => onChangeTheme(idx)}
                    className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-xs border border-black/15 shrink-0"
                      style={{ background: `linear-gradient(135deg, ${th.bg[0]}, ${th.accent[0]})` }}
                    />
                    <span>{th.labelZh}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Hook & Title Inputs */}
        {showTextFields && (onChangeHookLine || onChangeTitle) && (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-0.5">
            {onChangeHookLine && (
              <div>
                <label htmlFor={`wb-hook-${engine}`} className="block font-medium text-slate-700">
                  首秒顶栏钩子 (Hook)
                </label>
                <input
                  id={`wb-hook-${engine}`}
                  type="text"
                  maxLength={80}
                  value={hookLine}
                  onChange={(e) => onChangeHookLine(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            )}
            {onChangeTitle && (
              <div>
                <label htmlFor={`wb-title-${engine}`} className="block font-medium text-slate-700">
                  发布标题 (Title)
                </label>
                <input
                  id={`wb-title-${engine}`}
                  type="text"
                  maxLength={100}
                  value={title}
                  onChange={(e) => onChangeTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Native Studio Spec Mode
  const {
    melodies,
    melodyId,
    tempoBpm,
    motionSpeedScale,
    instrument,
    transpose,
    reverb,
    paletteFamily,
    seed,
    hookLine = '',
    title = '',
    durationSec,
    onChangeNative,
  } = props;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/75 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-600" />
          <span>原生生产线音画微调 (曲目 / 速度 / 音色 / 种子)</span>
        </div>
        <span className="font-mono text-[11px] text-slate-600 tabular-nums">
          {durationSec}s · {tempoBpm} BPM · 物理倍率 {motionSpeedScale.toFixed(2)}×
        </span>
      </div>

      {/* Motion Speed Scale + Tempo BPM */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="native-motion-speed" className="font-medium text-slate-700">
              物理与碰撞速率
            </label>
            <div className="flex items-center gap-1">
              {[0.75, 1, 1.25, 1.5].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChangeNative({ motionSpeedScale: preset })}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    Math.abs(motionSpeedScale - preset) < 0.02
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {preset}×
                </button>
              ))}
            </div>
          </div>
          <input
            id="native-motion-speed"
            type="range"
            min={0.6}
            max={2.0}
            step={0.05}
            value={motionSpeedScale}
            onChange={(e) => onChangeNative({ motionSpeedScale: Number(e.target.value) })}
            className="mt-2 h-1.5 w-full cursor-pointer accent-slate-900"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="native-tempo-bpm" className="font-medium text-slate-700">
              音乐参考节拍 (BPM)
            </label>
            <span className="font-mono text-[11px] text-slate-600 tabular-nums">{tempoBpm} BPM</span>
          </div>
          <input
            id="native-tempo-bpm"
            type="range"
            min={60}
            max={210}
            step={2}
            value={tempoBpm}
            onChange={(e) => onChangeNative({ tempoBpm: Number(e.target.value) })}
            className="mt-2 h-1.5 w-full cursor-pointer accent-slate-900"
          />
        </div>
      </div>

      {/* Melody & Instrument */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor="native-melody" className="block font-medium text-slate-700">
            更换主旋律 ({melodies.length} 首曲库)
          </label>
          <select
            id="native-melody"
            value={melodyId}
            onChange={(e) => onChangeNative({ melodyId: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
          >
            {melodies.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({m.tempo_bpm} BPM)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="native-instrument" className="block font-medium text-slate-700">
            乐器音色 (Instrument)
          </label>
          <select
            id="native-instrument"
            value={instrument}
            onChange={(e) => onChangeNative({ instrument: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
          >
            {VOICE_OPTIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.labelZh}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transpose / Palette / Reverb / Seed */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 items-end">
        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="native-transpose" className="font-medium text-slate-700">
              半音移调
            </label>
            <span className="font-mono text-[11px] text-slate-600">
              {transpose > 0 ? `+${transpose}` : transpose} st
            </span>
          </div>
          <input
            id="native-transpose"
            type="range"
            min={-7}
            max={7}
            step={1}
            value={transpose}
            onChange={(e) => onChangeNative({ transpose: Number(e.target.value) })}
            className="mt-2 h-1.5 w-full cursor-pointer accent-slate-900"
          />
        </div>

        <div>
          <label htmlFor="native-palette" className="block font-medium text-slate-700">
            画风色板
          </label>
          <select
            id="native-palette"
            value={paletteFamily}
            onChange={(e) =>
              onChangeNative({
                paletteFamily: e.target.value as 'neon' | 'pastel' | 'mono' | 'warm' | 'cool',
              })
            }
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
          >
            {PALETTE_FAMILY_OPTIONS.map((pf) => (
              <option key={pf.id} value={pf.id}>
                {pf.label}
              </option>
            ))}
          </select>
        </div>

        <label className="inline-flex h-[32px] cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-slate-700">
          <input
            type="checkbox"
            checked={reverb > 0.01}
            onChange={(e) => onChangeNative({ reverb: e.target.checked ? 0.16 : 0 })}
            className="h-3.5 w-3.5 accent-slate-900"
          />
          <span>空间混响</span>
        </label>

        <div>
          <label htmlFor="native-seed" className="block font-medium text-slate-700">
            随机种子
          </label>
          <div className="mt-1 flex items-center gap-1">
            <input
              id="native-seed"
              type="number"
              min={1}
              value={seed}
              onChange={(e) => onChangeNative({ seed: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
              className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onChangeNative({ seed: Math.floor(100000 + Math.random() * 899999) })}
              aria-label="随机新种子"
              className="shrink-0 rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Hook & Title */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label htmlFor="native-hook" className="block font-medium text-slate-700">
            首秒钩子文案 (Hook)
          </label>
          <input
            id="native-hook"
            type="text"
            maxLength={80}
            value={hookLine}
            onChange={(e) => onChangeNative({ hookLine: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="native-title" className="block font-medium text-slate-700">
            视频标题 (Title)
          </label>
          <input
            id="native-title"
            type="text"
            maxLength={100}
            value={title}
            onChange={(e) => onChangeNative({ title: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-900 focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
};
