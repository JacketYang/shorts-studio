import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Film, HardDrive, Pause, Play, RotateCcw, UploadCloud, Volume2, VolumeX } from 'lucide-react';
import {
  arcIntensity,
  bgBrightnessMult,
  hookPeekFactor,
  particleMult,
  resolveArcConfig,
  resolveFxConfig,
  runDeterministicSimulation,
  zoomMult,
} from '../domain/simulation';
import type { MelodyEntry, VideoSpec, WorkbenchRecipeMeta } from '../domain/types';
import { extractWorkbenchMetaFromSpec, WORKBENCH_ENGINE_LABELS, workbenchMetaToWorkbenchSpec } from '../workbench/bridge';
import { makeAudioBuffer } from '../workbench/engine/audio';
import { drawStill } from '../workbench/engine/preview';
import { renderVideo } from '../workbench/engine/render';
import { buildScene, themeOf } from '../workbench/scenes';

interface SimulationPlayerProps {
  spec: VideoSpec;
  melody?: MelodyEntry;
  compact?: boolean;
  /** T11：若该 spec 已渲染出 MP4，传入 render id 后可在"看成片"里播放 */
  renderId?: string | null;
  /** T11：该 render 是否已 completed（只有完成才有 MP4） */
  renderCompleted?: boolean;
  /** 工坊音画引擎配方（存在时使用 19 种工坊高清 Canvas + WebAudio 引擎） */
  workbenchMeta?: WorkbenchRecipeMeta | null;
  /** 浏览器工坊成片是否已渲染并存入统一存储目录 */
  mediaReady?: boolean;
  /** 统一存储位置提示（如 data/media/renders） */
  storageHint?: string;
  /** 在播放器内触发“生成 1080p 成片并存入生产线存储”成功后的刷新回调 */
  onMediaUploaded?: () => Promise<void> | void;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export const SimulationPlayer: React.FC<SimulationPlayerProps> = ({
  spec,
  melody,
  compact = false,
  renderId = null,
  renderCompleted = false,
  workbenchMeta = null,
  mediaReady = false,
  storageHint,
  onMediaUploaded,
}) => {
  const effectiveWbMeta = useMemo(
    () => workbenchMeta ?? extractWorkbenchMetaFromSpec(spec),
    [workbenchMeta, spec]
  );

  const wbBundle = useMemo(() => {
    if (!effectiveWbMeta) return null;
    try {
      const wbSpec = workbenchMetaToWorkbenchSpec(
        effectiveWbMeta,
        spec.publish.title,
        spec.publish.description,
        spec.publish.tags
      );
      const scene = buildScene(wbSpec);
      const theme = themeOf(wbSpec);
      return { wbSpec, scene, theme };
    } catch {
      return null;
    }
  }, [effectiveWbMeta, spec.publish.title, spec.publish.description, spec.publish.tags]);

  const sim = useMemo(() => runDeterministicSimulation(spec, melody), [spec, melody]);
  const effectiveDuration = wbBundle ? wbBundle.scene.duration : sim.duration_sec;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wbAudioBufRef = useRef<{ sceneKey: string; buffer: AudioBuffer } | null>(null);
  const wbAudioSrcRef = useRef<AudioBufferSourceNode | null>(null);

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showSafeZone, setShowSafeZone] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // T11：预览 / 成片切换
  const [viewMode, setViewMode] = useState<'preview' | 'final'>('preview');
  const [renderingMedia, setRenderingMedia] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{ stage: string; p: number } | null>(null);
  const [renderFeedback, setRenderFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const cancelTokenRef = useRef({ cancelled: false });

  const timeRef = useRef(0);
  const lastFrameTsRef = useRef<number | null>(null);
  const playedEventIdxRef = useRef(0);

  const canViewFinal = Boolean(renderCompleted && renderId && (!wbBundle || mediaReady));

  // T11：预览用的强度/特效派生（不参与 sim_hash）
  const arcCfg = useMemo(() => resolveArcConfig(spec), [spec]);
  const fxCfg = useMemo(() => resolveFxConfig(spec), [spec]);

  /** 预览粒子池（最多 30 个） */
  const particlesRef = useRef<Array<{
    x: number; y: number; vx: number; vy: number; t0: number; life: number; r: number; color: string;
  }>>([]);
  /** 预览涟漪池 */
  const ripplesRef = useRef<Array<{ x: number; y: number; t0: number; color: string; strength: number }>>([]);
  /** 上一帧时间，用于判断是否回绕（回绕时清空拖尾痕迹） */
  const lastTRef = useRef(-1);

  const stopWbAudio = () => {
    try {
      wbAudioSrcRef.current?.stop();
    } catch {
      // ignore already stopped
    }
    wbAudioSrcRef.current = null;
  };

  const startWbAudioAt = (offsetSec: number) => {
    if (muted || !wbBundle) return;
    try {
      stopWbAudio();
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const key = `${wbBundle.wbSpec.id}:${wbBundle.wbSpec.seed}:${wbBundle.wbSpec.theme}:${JSON.stringify(wbBundle.wbSpec.params ?? {})}:${wbBundle.scene.duration.toFixed(3)}`;
      let buf = wbAudioBufRef.current?.sceneKey === key ? wbAudioBufRef.current.buffer : null;
      if (!buf) {
        buf = makeAudioBuffer(wbBundle.scene.audio, wbBundle.scene.duration, wbBundle.scene.echo ?? true);
        wbAudioBufRef.current = { sceneKey: key, buffer: buf };
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const safeOffset = Math.max(0, Math.min(Math.max(0, wbBundle.scene.duration - 0.05), offsetSec));
      src.start(0, safeOffset);
      wbAudioSrcRef.current = src;
    } catch {
      // Ignore browser autoplay restrictions when headless
    }
  };

  const playNote = (midi: number, intensity: number) => {
    if (muted) return;
    try {
      if (!audioCtxRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const inst = spec.audio.music?.instrument ?? 'marimba';
      osc.type =
        inst === 'pluck' || inst === 'pizzicato' || spec.scene.template === 'ball-sort'
          ? 'triangle'
          : inst === 'rhodes'
            ? 'sine'
            : inst === 'blip'
              ? 'square'
              : 'sine';
      osc.frequency.setValueAtTime(midiToFreq(midi), now);

      const decay =
        inst === 'bell' || inst === 'celesta'
          ? 0.55
          : inst === 'click' || inst === 'tick'
            ? 0.08
            : inst === 'pizzicato'
              ? 0.22
              : 0.34;
      const peak = Math.min(0.22, (inst === 'blip' ? 0.05 : 0.08) + intensity * 0.14);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + decay + 0.03);
    } catch {
      // Ignore browser autoplay restrictions when headless
    }
  };

  const drawSafeZoneOverlay = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.35)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(0, h * 0.1);
    ctx.lineTo(w, h * 0.1);
    ctx.moveTo(0, h * 0.8);
    ctx.lineTo(w, h * 0.8);
    ctx.moveTo(w * 0.88, h * 0.42);
    ctx.lineTo(w * 0.88, h * 0.8);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.22)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(w * 0.94, h * (0.49 + i * 0.075), 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(248, 250, 252, 0.65)';
    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('TOP UI (10%)', 8, 15);
    ctx.fillText('BOTTOM CAPTION (20%)', 8, h * 0.8 + 14);
    ctx.restore();
  };

  // Draw deterministic frame onto 2D canvas
  const drawFrame = (tSec: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    if (wbBundle) {
      drawStill(canvas, wbBundle.scene, wbBundle.theme, wbBundle.wbSpec.hook, tSec);
      if (showSafeZone) {
        drawSafeZoneOverlay(ctx, w, h);
      }
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const bgColors = spec.scene.style.background?.colors ?? ['#05060F', '#101437'];

    // ---- T11：强度曲线（与 T5 同一公式，只影响视觉表现） ----
    const I = arcIntensity(arcCfg, tSec, sim.duration_sec);
    const hp = hookPeekFactor(arcCfg, tSec, sim.duration_sec);
    const effI = Math.min(1, I + 0.25 * hp);
    const zoom = zoomMult(effI) * (1 + 0.08 * hp);
    const bgMult = bgBrightnessMult(effI) * (1 + 0.15 * hp);

    const trailCfg = spec.scene.style.trail;
    const trailFade = trailCfg?.fade && trailCfg.fade > 0 ? trailCfg.fade : 0.85;
    const coverAlpha = Math.max(0.08, Math.min(1, 1 - trailFade));
    const rewound = tSec < lastTRef.current - 0.05 || lastTRef.current < 0;
    lastTRef.current = tSec;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, bgColors[0] ?? '#05060F');
    grad.addColorStop(1, bgColors[1] ?? bgColors[0] ?? '#101437');

    if (!trailCfg?.enabled || rewound) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = coverAlpha;
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (bgMult !== 1) {
      ctx.globalAlpha = Math.min(0.5, Math.abs(bgMult - 1));
      ctx.fillStyle = bgMult > 1 ? '#FFFFFF' : '#000000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (spec.scene.style.background?.type === 'grid') {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 36) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 36) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }
    }

    const snapIdx = Math.min(
      sim.snapshots.length - 1,
      Math.max(0, Math.floor((tSec / Math.max(0.01, sim.duration_sec)) * (sim.snapshots.length - 1)))
    );
    const snap = sim.snapshots[snapIdx];

    if (snap) {
      if (spec.scene.template === 'pendulum-wave' && snap.pendulums) {
        const pivotY = h * 0.2;
        const pivotX = w * 0.5;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pivotX, pivotY);
        ctx.lineTo(pivotX, h * 0.84);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w * 0.2, pivotY);
        ctx.lineTo(w * 0.8, pivotY);
        ctx.stroke();

        for (const p of snap.pendulums) {
          const bx = p.bobX * w;
          const by = p.bobY * h;
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.38)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pivotX, pivotY);
          ctx.lineTo(bx, by);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(bx, by, Math.max(4, p.r * w), 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (spec.scene.template === 'orbit-sync' && snap.orbits) {
        const cx = w * 0.5;
        const cy = h * 0.5;
        const trigRad = snap.triggerAngleRad ?? -Math.PI / 2;

        for (const orb of snap.orbits) {
          const rr = orb.ringR * w;
          ctx.beginPath();
          ctx.arc(cx, cy, rr, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(248, 250, 252, 0.82)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(trigRad) * w * 0.46, cy + Math.sin(trigRad) * w * 0.46);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#F8FAFC';
        ctx.fill();

        for (const orb of snap.orbits) {
          const bx = cx + (orb.bobX - 0.5) * w;
          const by = cy + (orb.bobY - 0.5) * w;
          ctx.beginPath();
          ctx.arc(bx, by, Math.max(4, orb.r * w), 0, Math.PI * 2);
          ctx.fillStyle = orb.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.55)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (spec.scene.template === 'rings-escape' && snap.rings) {
        const cx = w * 0.5;
        const cy = h * 0.5;

        for (const ring of snap.rings) {
          const rr = ring.radius * w;
          const half = ring.gap / 2;
          const a0 = ring.angle + half;
          const a1 = ring.angle - half + Math.PI * 2;
          const colors = ['#38BDF8', '#A78BFA', '#F472B6', '#FBBF24'];
          const col = colors[ring.idx % colors.length];

          ctx.beginPath();
          ctx.arc(cx, cy, rr, a0, a1, false);
          ctx.strokeStyle = col;
          ctx.lineWidth = Math.max(1.5, w * 0.006);
          ctx.stroke();

          for (const ga of [ring.angle + half, ring.angle - half]) {
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ga) * rr, cy + Math.sin(ga) * rr, Math.max(2, w * 0.008), 0, Math.PI * 2);
            ctx.fillStyle = col;
            ctx.fill();
          }
        }

        for (const b of snap.balls) {
          const bx = cx + (b.x - 0.5) * w;
          const by = cy + (b.y - 0.5) * w;
          const br = Math.max(3, b.r * w);

          const bGrad = ctx.createRadialGradient(bx, by, br * 0.2, bx, by, br * 2.6);
          bGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
          bGrad.addColorStop(0.45, b.color);
          bGrad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.beginPath();
          ctx.arc(bx, by, br * 2.6, 0, Math.PI * 2);
          ctx.fillStyle = bGrad;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(bx, by, br * 1.15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(bx, by, br, 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.fill();
        }
      } else if (spec.scene.template === 'ball-sort') {
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(w * 0.14, h * 0.22);
        ctx.lineTo(w * 0.14, h * 0.88);
        ctx.lineTo(w * 0.86, h * 0.88);
        ctx.lineTo(w * 0.86, h * 0.22);
        ctx.stroke();

        const binCount = snap.binCounts?.length ?? 4;
        for (let b = 1; b < binCount; b++) {
          const bx = w * (0.14 + (0.72 / binCount) * b);
          ctx.beginPath();
          ctx.moveTo(bx, h * 0.72);
          ctx.lineTo(bx, h * 0.88);
          ctx.stroke();
        }
      } else {
        const cx = w * 0.5;
        const cy = h * 0.5;
        const radius = w * 0.35 * snap.arenaScale;
        const shape = String((spec.scene.params as { arena?: { shape?: string } })?.arena?.shape ?? 'circle');
        const sides = shape === 'hexagon' ? 6 : shape === 'triangle' ? 3 : shape === 'polygon' ? 5 : 48;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(snap.arenaAngle);
        ctx.strokeStyle = spec.scene.style.palette.colors[0] ?? '#38BDF8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = 0; i <= sides; i++) {
          const a = (i / sides) * Math.PI * 2;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
      }

      for (const b of snap.balls) {
        const baseX = b.x * w;
        const baseY = spec.scene.template === 'ball-sort' ? b.y * h : h * 0.5 + (b.y - 0.5) * w;
        const bx = w * 0.5 + (baseX - w * 0.5) * zoom;
        const by = h * 0.5 + (baseY - h * 0.5) * zoom;
        const br = Math.max(3, b.r * w) * (1 + 0.06 * effI);

        ctx.save();
        ctx.shadowColor = b.color;
        ctx.shadowBlur = br * 2.5;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.fill();
        ctx.restore();

        ctx.beginPath();
        ctx.arc(bx, by, br * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fill();

        if (!fxCfg.disabled) {
          for (const ev of sim.events) {
            if (Math.abs(ev.t - tSec) > 0.05) continue;
            if (ev.type === 'wall_bounce' || ev.type === 'bin_drop' || ev.type === 'ring_pass') {
              const ex = w * 0.5 + (ev.x * w - w * 0.5) * zoom;
              const ey = h * 0.5 + (ev.y * h - h * 0.5) * zoom;
              const strength = ev.intensity * Math.max(0.2, fxCfg.ripple);
              if (ripplesRef.current.length < 12) {
                ripplesRef.current.push({ x: ex, y: ey, t0: tSec, color: ev.color ?? b.color, strength });
              }
              const n = Math.round(3 * particleMult(effI) * fxCfg.particles * ev.intensity);
              for (let k = 0; k < n && particlesRef.current.length < 30; k++) {
                const ang = (k / Math.max(1, n)) * Math.PI * 2 + tSec;
                const sp = (0.6 + Math.random() * 0.9) * br * 4;
                particlesRef.current.push({
                  x: ex, y: ey,
                  vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                  t0: tSec, life: 0.45, r: Math.max(1.2, br * 0.28),
                  color: ev.color ?? b.color,
                });
              }
            }
          }
        }
      }
    }

    ripplesRef.current = ripplesRef.current.filter((r) => tSec - r.t0 < 0.5 && tSec >= r.t0);
    for (const r of ripplesRef.current) {
      const age = (tSec - r.t0) / 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, w * 0.02 + age * w * 0.09, 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - age) * 0.55 * r.strength;
      ctx.lineWidth = 2.5 * (1 - age) + 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    particlesRef.current = particlesRef.current.filter((p) => tSec - p.t0 < p.life && tSec >= p.t0);
    if (particlesRef.current.length > 30) particlesRef.current = particlesRef.current.slice(-30);
    for (const p of particlesRef.current) {
      const age = (tSec - p.t0) / p.life;
      const px = p.x + p.vx * (tSec - p.t0);
      const py = p.y + p.vy * (tSec - p.t0) + 60 * (tSec - p.t0) ** 2;
      ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.beginPath();
      ctx.arc(px, py, p.r * (1 - 0.4 * age), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (fxCfg.vignette > 0) {
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.72);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, `rgba(0,0,0,${(0.55 * fxCfg.vignette).toFixed(3)})`);
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);
    }

    for (const item of spec.timeline) {
      if (item.type !== 'text') continue;
      const startT = item.t < 0 ? sim.duration_sec + item.t : item.t;
      const endT = startT + item.dur;
      if (tSec >= startT && tSec <= endT) {
        const yPos = item.position === 'top-safe' ? h * 0.16 : item.position === 'bottom-safe' ? h * 0.76 : h * 0.5;
        let scale = 1;
        let alpha = 1;
        if (item.role === 'hook') {
          const age = tSec - startT;
          if (age < 0.22) {
            const k = Math.max(0, age) / 0.22;
            scale = 0.72 + 0.34 * Math.sin(k * Math.PI * 0.85);
            alpha = Math.min(1, k * 4);
          } else if (age < 0.3) {
            scale = 1.06 - 0.06 * ((age - 0.22) / 0.08);
          }
          const fadeOutStart = endT - 0.25;
          if (tSec > fadeOutStart) alpha = Math.max(0, (endT - tSec) / 0.25);
        }

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(w / 2, yPos);
        ctx.scale(scale, scale);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.font = item.role === 'hook' ? '700 19px "Plus Jakarta Sans", sans-serif' : '600 13px "DM Sans", sans-serif';
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = 8;
        ctx.fillText(item.text, 0, 0, w - 48);
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    if (showSafeZone) {
      drawSafeZoneOverlay(ctx, w, h);
    }
  };

  useEffect(() => {
    stopWbAudio();
    timeRef.current = 0;
    playedEventIdxRef.current = 0;
    setCurrentTime(0);
    setPlaying(false);
    setViewMode('preview');
    setRenderFeedback(null);
    drawFrame(0);
    return () => {
      stopWbAudio();
    };
  }, [sim, wbBundle]);

  useEffect(() => {
    drawFrame(timeRef.current);
  }, [showSafeZone]);

  useEffect(() => {
    if (!playing) {
      lastFrameTsRef.current = null;
      stopWbAudio();
      return;
    }

    if (wbBundle && !muted) {
      startWbAudioAt(timeRef.current);
    }

    let rafId = 0;
    const step = (ts: number) => {
      if (lastFrameTsRef.current === null) lastFrameTsRef.current = ts;
      const dt = Math.min(0.1, (ts - lastFrameTsRef.current) / 1000);
      lastFrameTsRef.current = ts;

      let nextT = timeRef.current + dt;
      if (nextT >= effectiveDuration) {
        if (spec.format.loop.enabled) {
          nextT = 0;
          playedEventIdxRef.current = 0;
          if (wbBundle && !muted) {
            startWbAudioAt(0);
          }
        } else {
          nextT = effectiveDuration;
          setPlaying(false);
          stopWbAudio();
        }
      }

      if (!wbBundle) {
        while (
          playedEventIdxRef.current < sim.events.length &&
          sim.events[playedEventIdxRef.current].t <= nextT
        ) {
          const ev = sim.events[playedEventIdxRef.current];
          if (ev.midi !== undefined) {
            playNote(ev.midi, ev.intensity);
          }
          playedEventIdxRef.current++;
        }
      }

      timeRef.current = nextT;
      setCurrentTime(nextT);
      drawFrame(nextT);

      if (nextT < effectiveDuration || spec.format.loop.enabled) {
        rafId = requestAnimationFrame(step);
      }
    };

    rafId = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafId);
      stopWbAudio();
    };
  }, [playing, muted, sim, spec, wbBundle, effectiveDuration]);

  const handleReset = () => {
    setPlaying(false);
    stopWbAudio();
    timeRef.current = 0;
    playedEventIdxRef.current = 0;
    setCurrentTime(0);
    drawFrame(0);
  };

  const handleScrub = (val: number) => {
    timeRef.current = val;
    playedEventIdxRef.current = sim.events.findIndex((e) => e.t >= val);
    if (playedEventIdxRef.current < 0) playedEventIdxRef.current = sim.events.length;
    setCurrentTime(val);
    drawFrame(val);
    if (playing && wbBundle && !muted) {
      startWbAudioAt(val);
    }
  };

  const handleRenderAndStoreMedia = async () => {
    if (!wbBundle || !renderId || renderingMedia) return;
    setRenderingMedia(true);
    setRenderFeedback(null);
    cancelTokenRef.current = { cancelled: false };
    setRenderProgress({ stage: '构建音画场景', p: 0 });
    try {
      const out = await renderVideo(wbBundle.scene, wbBundle.theme, wbBundle.wbSpec.hook, {
        width: 1080,
        height: 1920,
        fps: 30,
        bitrate: 7e6,
        token: cancelTokenRef.current,
        onProgress: (p, stage) => setRenderProgress({ stage, p }),
      });
      setRenderProgress({ stage: '写入生产线存储', p: 0.99 });
      const res = await fetch(`/api/renders/${renderId}/upload-media?ext=${out.ext}`, {
        method: 'POST',
        headers: { 'Content-Type': out.ext === 'webm' ? 'video/webm' : 'video/mp4' },
        body: out.blob,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRenderFeedback({ ok: false, text: data.error ?? '保存成片失败' });
      } else {
        const mb = ((data.bytes ?? out.blob.size) / 1048576).toFixed(1);
        const dest = data.storagePath || storageHint || 'data/media/renders';
        setRenderFeedback({
          ok: true,
          text: `成片已存入 ${dest} (${out.ext.toUpperCase()} · ${mb} MB)`,
        });
        await onMediaUploaded?.();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '渲染成片失败';
      if (msg !== 'cancelled') {
        setRenderFeedback({ ok: false, text: msg });
      }
    } finally {
      setRenderingMedia(false);
      setRenderProgress(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`relative mx-auto overflow-hidden rounded-lg border border-slate-200 bg-slate-950 ${
          compact ? 'w-[240px]' : 'w-[292px]'
        }`}
        style={{ aspectRatio: '9 / 16' }}
      >
        {viewMode === 'final' && canViewFinal && renderId ? (
          <video
            src={`/api/renders/${encodeURIComponent(renderId)}/mp4`}
            controls
            autoPlay={false}
            loop={spec.format.loop.enabled}
            muted={muted}
            playsInline
            data-testid="final-video"
            className="h-full w-full block bg-black object-contain"
          />
        ) : (
          <>
            <canvas
              ref={canvasRef}
              width={wbBundle ? 360 : 324}
              height={wbBundle ? 640 : 576}
              data-testid="simulation-canvas"
              className="h-full w-full block"
            />
            <div className="absolute bottom-2 right-2 rounded bg-slate-950/80 px-2 py-0.5 font-mono text-[11px] text-slate-200 tabular-nums">
              {currentTime.toFixed(1)}s / {effectiveDuration.toFixed(1)}s
            </div>
          </>
        )}

        {canViewFinal && renderId ? (
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'final' ? 'preview' : 'final'))}
            className="absolute left-2 top-2 flex items-center gap-1 rounded bg-slate-950/80 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-800"
            data-testid="toggle-final"
          >
            <Film size={12} />
            {viewMode === 'final' ? '看预览' : '看成片'}
          </button>
        ) : null}
      </div>

      <p className="mx-auto w-full max-w-[320px] text-center text-[11px] leading-snug text-slate-500">
        {wbBundle
          ? `工坊高清引擎：${WORKBENCH_ENGINE_LABELS[wbBundle.wbSpec.engine] ?? wbBundle.wbSpec.engine} · 配色 ${wbBundle.theme.name}`
          : '预览为近似效果，最终画面以渲染出的 MP4 为准。'}
      </p>

      <div className="mx-auto flex w-full max-w-[320px] flex-col gap-2">
        <input
          type="range"
          min={0}
          max={effectiveDuration}
          step={0.1}
          value={currentTime}
          aria-label="预览时间轴"
          onChange={(e) => handleScrub(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer accent-slate-900"
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? '暂停模拟' : '播放模拟'}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? '暂停' : '播放预览'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              aria-label="重置到首帧"
              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? '取消静音' : '静音'}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setShowSafeZone((s) => !s)}
              aria-label="切换安全区参考线"
              title="仅预览时显示 YouTube 按钮/文字遮挡线（不会导出到 MP4，画面始终居中）"
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1.5 text-xs whitespace-nowrap shrink-0 ${
                showSafeZone
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {showSafeZone ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              UI 参考线
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono tabular-nums">
          {wbBundle ? (
            <>
              <span>合成音符 {wbBundle.scene.audio.length} 次</span>
              <span>时长 {wbBundle.scene.duration.toFixed(1)}s</span>
            </>
          ) : (
            <>
              <span>碰撞音符 {sim.events.filter((e) => e.midi !== undefined).length} 次</span>
              <span>首音 {sim.hook_audio_onset_sec.toFixed(2)}s</span>
            </>
          )}
        </div>

        {wbBundle && renderId && (
          <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                {mediaReady ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-700">成片已存入生产线存储</span>
                  </>
                ) : (
                  <>
                    <HardDrive className="h-3.5 w-3.5 text-slate-500" />
                    <span>待写入：{storageHint ?? 'data/media/renders'}</span>
                  </>
                )}
              </span>
            </div>

            {renderProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <span>{renderProgress.stage}</span>
                  <span className="font-mono tabular-nums">{Math.round(renderProgress.p * 100)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-slate-900 transition-all"
                    style={{ width: `${Math.round(renderProgress.p * 100)}%` }}
                  />
                </div>
              </div>
            )}

            <button
              type="button"
              disabled={renderingMedia}
              onClick={handleRenderAndStoreMedia}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <UploadCloud className="h-3.5 w-3.5" />
              {renderingMedia
                ? '正在合成 1080p 成片…'
                : mediaReady
                  ? '重新渲染并覆盖生产线成片'
                  : '渲染 1080p 成片并存入生产线存储'}
            </button>

            {renderFeedback && (
              <div
                className={`text-[11px] font-medium ${
                  renderFeedback.ok ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {renderFeedback.text}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
