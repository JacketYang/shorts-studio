/**
 * 把仓库内置的 4 个 fixture（melody-bounce / ball-sort / pendulum-wave / orbit-sync）
 * 导出成渲染 worker 可直接消费的 payload JSON。
 *
 * 用途：建立「改前 / 改后」对比基线。改了渲染逻辑后重新导出并渲染，
 * 用 bench.py 的耗时与文件大小、以及 MP4 本身做回归对比。
 *
 * 运行：npx tsx scripts/export_fixtures.ts
 * 产物：out/payloads/<name>.json，格式 { "spec": VideoSpec, "melody": MelodyEntry | null }
 */

import fs from 'node:fs';
import path from 'node:path';

import { INITIAL_MELODIES } from '../src/domain/melodies.ts';
import {
  FIXTURE_BALL_SORT,
  FIXTURE_MELODY_BOUNCE,
  FIXTURE_ORBIT_SYNC,
  FIXTURE_PENDULUM_WAVE,
} from '../src/domain/templates.ts';
import type { MelodyEntry, VideoSpec } from '../src/domain/types.ts';

/** 输出名 → spec。名字同时用作 JSON 文件名与 MP4 文件名。 */
const FIXTURES: Array<{ name: string; spec: VideoSpec }> = [
  { name: 'melody-bounce', spec: FIXTURE_MELODY_BOUNCE },
  { name: 'ball-sort', spec: FIXTURE_BALL_SORT },
  { name: 'pendulum-wave', spec: FIXTURE_PENDULUM_WAVE },
  { name: 'orbit-sync', spec: FIXTURE_ORBIT_SYNC },
];

const OUT_DIR = path.resolve(process.cwd(), 'out', 'payloads');

/**
 * 按 spec.audio.music.melody_ref 在旋律库里找对应条目。
 * - source 不是 library，或没有引用 → null
 * - 引用了但库里找不到 → 打印警告并返回 null（渲染 worker 会用内置五声音阶兜底）
 */
function resolveMelody(spec: VideoSpec): MelodyEntry | null {
  const ref = spec.audio?.music?.melody_ref;
  if (!ref || ref.source !== 'library') return null;
  const found = INITIAL_MELODIES.find((m) => m.id === ref.id);
  if (!found) {
    console.warn(`  ⚠ 旋律 ${ref.id} 不在 INITIAL_MELODIES 中，将使用内置兜底音阶`);
    return null;
  }
  return found;
}

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(`导出 ${FIXTURES.length} 个 fixture 到 ${path.relative(process.cwd(), OUT_DIR)}/`);
  console.log('');

  const rows: Array<{ name: string; melodyId: string; bytes: number; duration: number }> = [];

  for (const { name, spec } of FIXTURES) {
    const melody = resolveMelody(spec);
    const payload = { spec, melody };

    const target = path.join(OUT_DIR, `${name}.json`);
    const json = JSON.stringify(payload, null, 2);
    fs.writeFileSync(target, json, 'utf8');

    rows.push({
      name,
      melodyId: melody?.id ?? '(none)',
      bytes: Buffer.byteLength(json, 'utf8'),
      duration: spec.format.duration_sec,
    });
  }

  // 汇总表
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`${pad('fixture', 16)}${pad('时长', 8)}${pad('旋律', 24)}${pad('payload', 12)}spec_key`);
  console.log('-'.repeat(100));
  for (const r of rows) {
    const spec = FIXTURES.find((f) => f.name === r.name)!.spec;
    console.log(
      `${pad(r.name, 16)}${pad(`${r.duration}s`, 8)}${pad(r.melodyId, 24)}${pad(`${(r.bytes / 1024).toFixed(1)} KB`, 12)}${spec.spec_key}`
    );
  }
  console.log('');
  console.log(`✅ 完成，共 ${rows.length} 个 payload`);
}

main();
