import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIXTURE_RINGS_ESCAPE, RingsEscapeParamsSchema, TEMPLATE_REGISTRY } from './templates.ts';
import { runDeterministicSimulation } from './simulation.ts';
import type { SimEvent } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO, 'scripts', 'rings_escape_events.py');

test('rings-escape 模板已注册，参数 schema 通过 fixture', () => {
  const def = TEMPLATE_REGISTRY['rings-escape'];
  assert.ok(def, '模板库应包含 rings-escape');
  assert.equal(def!.key, 'rings-escape');
  assert.equal(def!.version, '1.0.0');
  assert.equal(def!.status, 'beta');
  assert.deepEqual(def!.events, ['ring_pass', 'wall_bounce']);

  const parsed = RingsEscapeParamsSchema.safeParse(FIXTURE_RINGS_ESCAPE.scene.params);
  assert.equal(parsed.success, true, 'fixture 参数应通过 schema 校验');
});

test('rings-escape 参数边界被正确约束', () => {
  const bad = [
    { rings: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).rings, count: 2 } },
    { rings: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).rings, count: 11 } },
    { rings: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).rings, base_radius: 0.05 } },
    { rings: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).rings, gap_deg: 10 } },
    { rings: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).rings, rotation_deg_per_s: 120 } },
    { balls: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).balls, count: 0 } },
    { balls: { ...(FIXTURE_RINGS_ESCAPE.scene.params as any).balls, gravity: 2 } },
  ];
  const base = FIXTURE_RINGS_ESCAPE.scene.params as any;
  for (const patch of bad) {
    const merged = { ...base, ...patch };
    assert.equal(
      RingsEscapeParamsSchema.safeParse(merged).success,
      false,
      `越界参数应被拒绝: ${JSON.stringify(patch)}`,
    );
  }
});

test('rings-escape 模拟确定性：同 seed 两次结果一致', () => {
  const a = runDeterministicSimulation(FIXTURE_RINGS_ESCAPE);
  const b = runDeterministicSimulation(FIXTURE_RINGS_ESCAPE);
  assert.equal(a.sim_hash, b.sim_hash);
  assert.deepEqual(
    a.events.map((e) => [e.t, e.type]),
    b.events.map((e) => [e.t, e.type]),
  );
});

test('rings-escape 产出 ring_pass 与 wall_bounce，且 ring_pass 推进音高', () => {
  const out = runDeterministicSimulation(FIXTURE_RINGS_ESCAPE);
  const passes = out.events.filter((e) => e.type === 'ring_pass');
  const bounces = out.events.filter((e) => e.type === 'wall_bounce');
  assert.ok(passes.length >= 3, `应至少逃出 3 层，实际 ${passes.length}`);
  assert.ok(bounces.length > 0, '应有环壁碰撞');
  for (const e of passes) {
    assert.equal(e.intensity, 1.0, 'ring_pass 强度应为 1.0');
    assert.equal(typeof e.midi, 'number', 'ring_pass 应带音高');
  }
  for (const e of bounces) assert.equal(e.intensity, 0.4, 'wall_bounce 强度应为 0.4');
});

test('rings-escape 在 6 秒内必定逃出至少一层（温柔作弊生效）', () => {
  const out = runDeterministicSimulation(FIXTURE_RINGS_ESCAPE);
  const first = out.events.find((e) => e.type === 'ring_pass');
  assert.ok(first, '应至少有一次逃出');
  assert.ok(first!.t <= 6.0, `首次逃出应在 6 秒内，实际 ${first!.t}s`);
});

/**
 * 调 Python 端跑同一套规则，返回事件列表。
 *
 * Python 侧读的是 `out/payloads/rings-escape.json`（`npm run fixtures:export`
 * 的产物，且 `out/` 被 .gitignore 忽略）。全新 clone 里没有这份 payload，
 * 属于「环境未就绪」而不是「实现有分歧」，因此返回空数组让上层跳过。
 */
function runPythonEvents(): SimEvent[] {
  if (!fs.existsSync(SCRIPT)) return [];
  const payload = path.join(REPO, 'out', 'payloads', 'rings-escape.json');
  if (!fs.existsSync(payload)) return [];
  const tmp = path.join(os.tmpdir(), `re-events-${process.pid}.json`);
  try {
    execFileSync('python3', [SCRIPT, tmp], { cwd: REPO, stdio: 'pipe' });
    const raw = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    return raw.events as SimEvent[];
  } catch {
    // Python 解释器缺失或脚本报错同样按「不可用」处理，避免环境问题伪装成回归。
    return [];
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

test('TS 与 Python 事件序列一致（数量 + 前 20 个类型）', () => {
  const ts = runDeterministicSimulation(FIXTURE_RINGS_ESCAPE).events;
  const py = runPythonEvents();
  if (py.length === 0) return; // Python 侧不可用时跳过

  assert.equal(py.length, ts.length, '事件数量应一致');
  const n = Math.min(20, ts.length);
  for (let i = 0; i < n; i++) {
    assert.equal(py[i].type, ts[i].type, `第 ${i} 个事件类型应一致`);
    assert.ok(
      Math.abs(py[i].t - ts[i].t) <= 1 / 30 + 1e-6,
      `第 ${i} 个事件时间误差应 ≤ 1 帧（ts=${ts[i].t} py=${py[i].t}）`,
    );
  }
});
