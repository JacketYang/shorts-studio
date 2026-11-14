import { mulberry32, sha256Hex } from './hash.ts';
import type { MelodyEntry, QACheckItem, SimEvent, VideoSpec } from './types.ts';

export interface BallState {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
  settledBin?: number;
}

export interface SimFrameSnapshot {
  t: number;
  arenaAngle: number;
  arenaScale: number;
  balls: Array<{ x: number; y: number; r: number; color: string }>;
  binCounts?: number[];
  gatePhase?: number;
  pendulums?: Array<{ pivotX: number; pivotY: number; bobX: number; bobY: number; r: number; color: string }>;
  orbits?: Array<{ cx: number; cy: number; ringR: number; angle: number; bobX: number; bobY: number; r: number; color: string }>;
  triggerAngleRad?: number;
}

export interface DeterministicSimOutput {
  sim_hash: string;
  duration_sec: number;
  fps: number;
  events: SimEvent[];
  qa_checks: QACheckItem[];
  qa_passed: boolean;
  snapshots: SimFrameSnapshot[];
  hook_motion_score: number;
  hook_audio_onset_sec: number;
}

function getMelodyNoteMidi(melody: MelodyEntry | undefined, noteIndex: number, transpose: number): number {
  if (!melody || melody.tracks.length === 0 || melody.tracks[0].notes.length === 0) {
    const pentatonic = [60, 62, 64, 67, 69, 72, 74, 76];
    return pentatonic[noteIndex % pentatonic.length] + transpose;
  }
  const notes = melody.tracks[0].notes;
  return notes[noteIndex % notes.length].pitch + transpose;
}

/**
 * Runs a 100% deterministic simulation for `melody-bounce` or `ball-sort` given spec + melody.
 * Used identically in browser Canvas preview and server QA/hash verification.
 */
export function runDeterministicSimulation(
  spec: VideoSpec,
  melody?: MelodyEntry
): DeterministicSimOutput {
  const rng = mulberry32(spec.scene.seed);
  const fps = spec.format.fps;
  const durationSec = spec.format.duration_sec;
  const totalFrames = Math.round(fps * durationSec);
  const dt = 1 / fps;
  const palette = spec.scene.style.palette.colors;
  const transpose = spec.audio.music?.transpose ?? 0;

  const events: SimEvent[] = [];
  const snapshots: SimFrameSnapshot[] = [];
  let noteCursor = 0;

  if (spec.scene.template === 'ball-sort') {
    const p = spec.scene.params as {
      balls: { count: number; colors: string[] };
      bins: { count: number };
      mechanism: { pegs: { rows: number; jitter: number }; gates: Array<{ type: string; period_s?: number }> };
    };
    const ballCount = p.balls?.count ?? 24;
    const ballColors = p.balls?.colors?.length ? p.balls.colors : palette;
    const binCount = p.bins?.count ?? 4;
    const binCounts = new Array(binCount).fill(0);

    const balls: BallState[] = [];
    for (let i = 0; i < ballCount; i++) {
      const targetBin = i % binCount;
      balls.push({
        id: i,
        x: 0.5 + (rng() - 0.5) * 0.24,
        y: 0.14 - i * 0.045,
        vx: (rng() - 0.5) * 0.08,
        vy: 0.18 + rng() * 0.06,
        r: 0.018,
        color: ballColors[targetBin % ballColors.length],
        trail: [],
      });
    }

    for (let f = 0; f < totalFrames; f++) {
      const t = Number((f * dt).toFixed(4));
      const gatePhase = Math.sin(t * 2.5);

      for (const b of balls) {
        if (b.settledBin !== undefined) continue;
        b.vy += 0.55 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // Funnel & peg guidance
        if (b.y > 0.24 && b.y < 0.72) {
          const targetX = 0.18 + ((b.id % binCount) + 0.5) * (0.64 / binCount);
          const pull = (targetX - b.x) * 2.2 * dt;
          b.vx += pull + (rng() - 0.5) * 0.015;
          if (f % 14 === (b.id * 3) % 14 && b.y > 0.28) {
            const midi = getMelodyNoteMidi(melody, noteCursor++, transpose);
            events.push({ t, type: 'note_trigger', x: b.x, y: b.y, intensity: 0.72, midi, color: b.color });
          }
        }

        if (b.x < 0.14) {
          b.x = 0.14;
          b.vx = Math.abs(b.vx) * 0.85;
        } else if (b.x > 0.86) {
          b.x = 0.86;
          b.vx = -Math.abs(b.vx) * 0.85;
        }

        if (b.y >= 0.82) {
          const binIdx = Math.min(binCount - 1, Math.max(0, Math.floor(((b.x - 0.12) / 0.76) * binCount)));
          b.settledBin = binIdx;
          binCounts[binIdx]++;
          b.y = 0.86 - Math.min(6, binCounts[binIdx]) * 0.024;
          b.vx = 0;
          b.vy = 0;
          const midi = getMelodyNoteMidi(melody, noteCursor++, transpose);
          events.push({ t, type: 'bin_drop', x: b.x, y: b.y, intensity: 0.9, midi, color: b.color });
        }
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
        snapshots.push({
          t,
          arenaAngle: 0,
          arenaScale: 1,
          gatePhase,
          binCounts: [...binCounts],
          balls: balls.map((b) => ({
            x: Number(b.x.toFixed(4)),
            y: Number(b.y.toFixed(4)),
            r: b.r,
            color: b.color,
          })),
        });
      }
    }
  } else if (spec.scene.template === 'pendulum-wave') {
    const p = spec.scene.params as {
      pendulum?: { count?: number; length_min?: number; length_step?: number; max_angle_deg?: number; damping?: number };
      rule?: { type?: string; cycle_sec?: number };
    };
    const count = Math.max(6, Math.min(24, p.pendulum?.count ?? 15));
    const lenMin = p.pendulum?.length_min ?? 0.24;
    const lenStep = p.pendulum?.length_step ?? 0.022;
    const maxAngleRad = ((p.pendulum?.max_angle_deg ?? 52) * Math.PI) / 180;
    const damping = p.pendulum?.damping ?? 0;
    const cycleSec = Math.max(8, p.rule?.cycle_sec ?? 24);
    const ruleType = p.rule?.type ?? 'harmonic_sweep';

    const baseOscillations = 12;
    const prevThetas = new Array<number>(count).fill(0);

    for (let f = 0; f < totalFrames; f++) {
      const t = Number((f * dt).toFixed(4));
      const framePendulums: NonNullable<SimFrameSnapshot['pendulums']> = [];
      const dampFactor = Math.exp(-damping * t);

      for (let i = 0; i < count; i++) {
        const oscCount = ruleType === 'phase_flip' ? baseOscillations + i * 1.5 : baseOscillations + i;
        const omega = (2 * Math.PI * oscCount) / cycleSec;
        const pulseMod = ruleType === 'gravity_pulse' ? 1 + 0.08 * Math.sin(t * 2.1) : 1;
        // Phase offset -1.15 ensures first zero-crossing occurs near t ~ 0.13s for immediate audio/motion hook
        const theta = maxAngleRad * dampFactor * Math.cos(omega * t * pulseMod - 1.15);
        const len = Math.min(0.62, lenMin + i * lenStep);
        const pivotX = 0.5;
        const pivotY = 0.20;
        const bobX = pivotX + Math.sin(theta) * len * 0.9;
        const bobY = pivotY + Math.cos(theta) * len;
        const color = palette[i % palette.length];

        if (f > 0 && ((prevThetas[i] < 0 && theta >= 0) || (prevThetas[i] > 0 && theta <= 0))) {
          const midi = getMelodyNoteMidi(melody, noteCursor++, transpose);
          const intensity = Math.min(1, 0.55 + (i / count) * 0.35);
          events.push({
            t,
            type: 'note_trigger',
            x: Number(bobX.toFixed(4)),
            y: Number(bobY.toFixed(4)),
            intensity: Number(intensity.toFixed(3)),
            midi,
            color,
          });
        }
        prevThetas[i] = theta;

        framePendulums.push({
          pivotX,
          pivotY,
          bobX: Number(bobX.toFixed(4)),
          bobY: Number(bobY.toFixed(4)),
          r: 0.018,
          color,
        });
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
        snapshots.push({
          t,
          arenaAngle: 0,
          arenaScale: 1,
          balls: [],
          pendulums: framePendulums,
        });
      }
    }
  } else if (spec.scene.template === 'orbit-sync') {
    const p = spec.scene.params as {
      orbits?: { count?: number; base_radius?: number; radius_step?: number; base_omega?: number; resonance_ratio?: number };
      rule?: { type?: string; trigger_angle_deg?: number };
    };
    const count = Math.max(4, Math.min(18, p.orbits?.count ?? 10));
    const baseR = p.orbits?.base_radius ?? 0.11;
    const stepR = p.orbits?.radius_step ?? 0.032;
    const baseOmega = p.orbits?.base_omega ?? 1.05;
    const resRatio = p.orbits?.resonance_ratio ?? 0.14;
    const ruleType = p.rule?.type ?? 'harmonic_align';
    const triggerAngleRad = (((p.rule?.trigger_angle_deg ?? -90) * Math.PI) / 180);

    const prevAngles: number[] = [];
    for (let i = 0; i < count; i++) {
      // Initialize right behind trigger beam so first planets cross within t <= 0.25s
      prevAngles.push(triggerAngleRad - 0.16 - i * 0.07);
    }

    for (let f = 0; f < totalFrames; f++) {
      const t = Number((f * dt).toFixed(4));
      const frameOrbits: NonNullable<SimFrameSnapshot['orbits']> = [];

      for (let i = 0; i < count; i++) {
        const dir = ruleType === 'reverse_outer' && i >= Math.floor(count / 2) ? -1 : 1;
        const omega = dir * baseOmega * (1 + i * resRatio);
        const angle = triggerAngleRad - 0.16 - i * 0.07 + omega * t;
        const ringR = Math.min(0.44, baseR + i * stepR);
        const bobX = 0.5 + Math.cos(angle) * ringR;
        const bobY = 0.5 + Math.sin(angle) * ringR;
        const color = palette[i % palette.length];

        if (f > 0) {
          const prevOffset = Math.floor((prevAngles[i] - triggerAngleRad) / (2 * Math.PI));
          const currOffset = Math.floor((angle - triggerAngleRad) / (2 * Math.PI));
          if (prevOffset !== currOffset) {
            const midi = getMelodyNoteMidi(melody, noteCursor++, transpose);
            const intensity = Math.min(1, 0.55 + (i / count) * 0.4);
            events.push({
              t,
              type: 'note_trigger',
              x: Number(bobX.toFixed(4)),
              y: Number(bobY.toFixed(4)),
              intensity: Number(intensity.toFixed(3)),
              midi,
              color,
            });
          }
        }
        prevAngles[i] = angle;

        frameOrbits.push({
          cx: 0.5,
          cy: 0.5,
          ringR: Number(ringR.toFixed(4)),
          angle: Number(angle.toFixed(4)),
          bobX: Number(bobX.toFixed(4)),
          bobY: Number(bobY.toFixed(4)),
          r: 0.017,
          color,
        });
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
        snapshots.push({
          t,
          arenaAngle: 0,
          arenaScale: 1,
          balls: [],
          orbits: frameOrbits,
          triggerAngleRad,
        });
      }
    }
  } else {
    // Default: melody-bounce
    const p = spec.scene.params as {
      arena: { shape: string; size: number; rotation_deg_per_s: number };
      balls: { count_start: number; radius: number; speed: number; restitution: number; gravity: number; max_count: number };
      rule: { type: string; every_n_bounces?: number; scale_factor?: number };
    };
    const startCount = p.balls?.count_start ?? 1;
    const baseRadius = p.balls?.radius ?? 0.028;
    const baseSpeed = p.balls?.speed ?? 0.55;
    const restitution = p.balls?.restitution ?? 1.0;
    const gravity = p.balls?.gravity ?? 0.0;
    const maxCount = p.balls?.max_count ?? 64;
    const rotDegPerS = p.arena?.rotation_deg_per_s ?? 6;
    const everyN = p.rule?.every_n_bounces ?? 3;
    const ruleType = p.rule?.type ?? 'split_on_bounce';

    let arenaRadius = (p.arena?.size ?? 0.78) * 0.44;
    const balls: BallState[] = [];
    for (let i = 0; i < startCount; i++) {
      // Aim initial ball near wall so first bounce occurs <= 0.35s for strong hook!
      const angle = (i / Math.max(1, startCount)) * Math.PI * 2 + 0.42;
      const startDist = arenaRadius * 0.72;
      balls.push({
        id: i,
        x: 0.5 + Math.cos(angle) * startDist,
        y: 0.5 + Math.sin(angle) * startDist,
        vx: Math.cos(angle + 0.25) * baseSpeed,
        vy: Math.sin(angle + 0.25) * baseSpeed,
        r: baseRadius,
        color: palette[i % palette.length],
        trail: [],
      });
    }

    let bounceCount = 0;
    for (let f = 0; f < totalFrames; f++) {
      const t = Number((f * dt).toFixed(4));
      const arenaAngle = (rotDegPerS * Math.PI * t) / 180;
      const newBalls: BallState[] = [];

      for (const b of balls) {
        b.vy += gravity * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const dx = b.x - 0.5;
        const dy = b.y - 0.5;
        const dist = Math.hypot(dx, dy);
        const maxDist = Math.max(0.08, arenaRadius - b.r);

        if (dist >= maxDist && dist > 0.0001) {
          const nx = dx / dist;
          const ny = dy / dist;
          b.x = 0.5 + nx * maxDist;
          b.y = 0.5 + ny * maxDist;

          const dot = b.vx * nx + b.vy * ny;
          if (dot > 0) {
            b.vx = (b.vx - 2 * dot * nx) * restitution;
            b.vy = (b.vy - 2 * dot * ny) * restitution;
            // Slight deterministic tangential jitter so balls fan out cleanly
            const jitter = (rng() - 0.5) * 0.08;
            const tx = -ny;
            const ty = nx;
            b.vx += tx * jitter;
            b.vy += ty * jitter;

            bounceCount++;
            const midi = getMelodyNoteMidi(melody, noteCursor++, transpose);
            const intensity = Math.min(1, Math.hypot(b.vx, b.vy) / 1.1);
            events.push({
              t,
              type: 'wall_bounce',
              x: b.x,
              y: b.y,
              intensity: Number(intensity.toFixed(3)),
              midi,
              color: b.color,
            });

            if (ruleType === 'split_on_bounce' && bounceCount % everyN === 0 && balls.length + newBalls.length < maxCount) {
              const splitColor = palette[(balls.length + newBalls.length) % palette.length];
              newBalls.push({
                id: balls.length + newBalls.length,
                x: b.x - nx * 0.01,
                y: b.y - ny * 0.01,
                vx: -b.vx * 0.96 + (rng() - 0.5) * 0.14,
                vy: -b.vy * 0.96 + (rng() - 0.5) * 0.14,
                r: Math.max(0.01, b.r * 0.94),
                color: splitColor,
                trail: [],
              });
              events.push({ t, type: 'ball_split', x: b.x, y: b.y, intensity: 0.65, color: splitColor });
            } else if (ruleType === 'grow_on_bounce') {
              b.r = Math.min(arenaRadius * 0.45, b.r * (p.rule.scale_factor ?? 1.03));
            } else if (ruleType === 'speed_up') {
              b.vx *= 1.03;
              b.vy *= 1.03;
            } else if (ruleType === 'shrink_wall') {
              arenaRadius = Math.max(0.18, arenaRadius * 0.992);
            }
          }
        }
      }

      if (newBalls.length > 0) {
        balls.push(...newBalls);
      }

      if (f % 3 === 0 || f === totalFrames - 1) {
        snapshots.push({
          t,
          arenaAngle: Number(arenaAngle.toFixed(4)),
          arenaScale: Number((arenaRadius / 0.34).toFixed(4)),
          balls: balls.map((b) => ({
            x: Number(b.x.toFixed(4)),
            y: Number(b.y.toFixed(4)),
            r: Number(b.r.toFixed(4)),
            color: b.color,
          })),
        });
      }
    }
  }

  // Deterministic state hash across snapshots & events
  const hashPayload = JSON.stringify({
    seed: spec.scene.seed,
    template: spec.scene.template,
    eventCount: events.length,
    firstEvents: events.slice(0, 8),
    lastSnap: snapshots[snapshots.length - 1],
  });
  const simHash = sha256Hex(hashPayload);

  // Hook & QA checks (docs 05 §10)
  const firstAudioEvent = events.find((e) => e.midi !== undefined);
  const hookAudioOnset = firstAudioEvent ? firstAudioEvent.t : 99;
  const earlySnaps = snapshots.filter((s) => s.t <= 1.5);
  let motionDelta = 0;
  if (earlySnaps.length >= 2) {
    const first = earlySnaps[0];
    const last = earlySnaps[earlySnaps.length - 1];
    const pA =
      first.balls[0] ??
      (first.pendulums?.[0] ? { x: first.pendulums[0].bobX, y: first.pendulums[0].bobY } : undefined) ??
      (first.orbits?.[0] ? { x: first.orbits[0].bobX, y: first.orbits[0].bobY } : undefined);
    const pB =
      last.balls[0] ??
      (last.pendulums?.[0] ? { x: last.pendulums[0].bobX, y: last.pendulums[0].bobY } : undefined) ??
      (last.orbits?.[0] ? { x: last.orbits[0].bobX, y: last.orbits[0].bobY } : undefined);
    if (pA && pB) motionDelta = Math.hypot(pB.x - pA.x, pB.y - pA.y);
  }
  const hookTextItem = spec.timeline.find(
    (item): item is Extract<(typeof spec.timeline)[number], { type: 'text' }> =>
      item.type === 'text' && item.role === 'hook'
  );
  const safeZoneOk = !hookTextItem || hookTextItem.position !== 'center';

  const qaChecks: QACheckItem[] = [
    {
      name: '画幅与帧率规格',
      passed: spec.format.width === 1080 && spec.format.height === 1920 && spec.format.fps === 30,
      actual: `${spec.format.width}x${spec.format.height} @ ${spec.format.fps}fps`,
      expected: '1080x1920 @ 30fps',
      severity: 'error',
    },
    {
      name: '首帧非空与前1.5秒运动钩子',
      passed: snapshots.length > 0 && motionDelta > 0.05,
      actual: `位移=${motionDelta.toFixed(3)}`,
      expected: '位移 > 0.05',
      severity: 'error',
    },
    {
      name: '前0.5秒音频起音',
      passed: hookAudioOnset <= 0.5,
      actual: `${hookAudioOnset.toFixed(2)}s`,
      expected: '<= 0.50s',
      severity: 'error',
    },
    {
      name: '响度与真峰值目标',
      passed: spec.audio.mix.target_lufs >= -15 && spec.audio.mix.target_lufs <= -13 && spec.audio.mix.true_peak_db <= -1,
      actual: `${spec.audio.mix.target_lufs} LUFS / ${spec.audio.mix.true_peak_db} dBTP`,
      expected: '-14±1 LUFS / <= -1 dBTP',
      severity: 'error',
    },
    {
      name: 'Shorts UI 安全区留空',
      passed: safeZoneOk,
      actual: hookTextItem?.position ?? 'none',
      expected: 'top-safe / bottom-safe',
      severity: 'warn',
    },
    {
      name: '标题长度与首评配置',
      passed: spec.publish.title.length <= 100 && Boolean(spec.publish.first_comment),
      actual: `${spec.publish.title.length} 字符`,
      expected: '<= 100 字符且含提问首评',
      severity: 'warn',
    },
  ];

  const qaPassed = qaChecks.filter((c) => c.severity === 'error').every((c) => c.passed);

  return {
    sim_hash: simHash,
    duration_sec: durationSec,
    fps,
    events,
    qa_checks: qaChecks,
    qa_passed: qaPassed,
    snapshots,
    hook_motion_score: Number(Math.min(1, motionDelta * 4).toFixed(2)),
    hook_audio_onset_sec: hookAudioOnset,
  };
}
