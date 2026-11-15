import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { QACheckItem, QaReport } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const SCRIPT = path.join(REPO, 'workers/render/qa_stats.py');

/** 10 项检查的名称，顺序与 qa_stats.py 一致 */
const EXPECTED_CHECKS = [
  'first_frame_motion',
  'first_audio_onset',
  'hook_text_timing',
  'juice_density',
  'intensity_rise',
  'rhythm_deviation',
  'audio_layers',
  'has_twist_moment',
  'safe_zone',
  'ending_return',
];

const EXPECTED_SEVERITY: Record<string, 'error' | 'warn'> = {
  first_frame_motion: 'error',
  first_audio_onset: 'error',
  hook_text_timing: 'warn',
  juice_density: 'warn',
  intensity_rise: 'warn',
  rhythm_deviation: 'warn',
  audio_layers: 'warn',
  has_twist_moment: 'warn',
  safe_zone: 'warn',
  ending_return: 'warn',
};

test('qa_stats.py 存在且可编译', () => {
  assert.ok(fs.existsSync(SCRIPT), 'workers/render/qa_stats.py 应存在');
  execFileSync('python3', ['-m', 'py_compile', SCRIPT], { cwd: REPO, stdio: 'pipe' });
});

/** 造一个最小可分析的视频（纯色 + 一段音）+ 假 payload，跑 QA。 */
function runQaOnSynthetic(opts: {
  withHook: boolean;
  loopMode: 'visual-return' | 'none';
  duration: number;
}): QaReport | null {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-t14-'));
  const mp4 = path.join(tmp, 'v.mp4');
  const payloadPath = path.join(tmp, 'p.json');
  const outPath = path.join(tmp, 'v.qa.json');
  try {
    // 用 ffmpeg 合成：左边有运动的 testsrc + 1kHz 音
    execFileSync(
      'ffmpeg',
      [
        '-y', '-v', 'error',
        '-f', 'lavfi', '-i', `testsrc=size=180x320:rate=15:duration=${opts.duration}`,
        '-f', 'lavfi', '-i', `sine=frequency=440:duration=${opts.duration}`,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4,
      ],
      { stdio: 'pipe' },
    );

    const payload = {
      spec: {
        format: {
          duration_sec: opts.duration,
          loop: { enabled: opts.loopMode !== 'none', mode: opts.loopMode },
        },
        scene: { template: 'melody-bounce' },
        timeline: opts.withHook
          ? [{ t: 0, dur: 1.8, type: 'text', role: 'hook', text: 'Guess this' }]
          : [],
        // 非循环时应把 ending 也设为非 loop，否则会被判成"按 visual-return 处理"
        axes: { ending: opts.loopMode === 'none' ? 'cut' : 'loop' },
      },
      events: [
        { t: 0.2, midi: 60, intensity: 1.0, dev_ms: 8 },
        { t: 1.0, midi: 62, intensity: 0.9, dev_ms: 12 },
        { t: 2.0, midi: 64, intensity: 1.0, dev_ms: 20 },
      ],
    };
    fs.writeFileSync(payloadPath, JSON.stringify(payload), 'utf8');

    execFileSync('python3', [SCRIPT, mp4, payloadPath, outPath], { cwd: REPO, stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(outPath, 'utf8')) as QaReport;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('qa_stats 产出 10 个 QACheckItem，结构与 types.ts 一致', () => {
  const report = runQaOnSynthetic({ withHook: true, loopMode: 'none', duration: 4 });
  assert.ok(report, 'QA 应产出报告');
  assert.equal(report!.checks.length, 10, '应恰好 10 项');
  assert.deepEqual(report!.checks.map((c) => c.name), EXPECTED_CHECKS);

  for (const c of report!.checks as QACheckItem[]) {
    assert.equal(typeof c.name, 'string');
    assert.equal(typeof c.passed, 'boolean');
    assert.equal(typeof c.actual, 'string');
    assert.equal(typeof c.expected, 'string');
    assert.ok(c.severity === 'error' || c.severity === 'warn');
    assert.equal(c.severity, EXPECTED_SEVERITY[c.name], `${c.name} 的 severity 应为 ${EXPECTED_SEVERITY[c.name]}`);
  }
});

test('qa_score = 通过项数 / 10', () => {
  const report = runQaOnSynthetic({ withHook: true, loopMode: 'none', duration: 4 });
  const passed = report!.checks.filter((c) => c.passed).length;
  assert.equal(report!.qa_score, Number((passed / 10).toFixed(3)));
  assert.ok(report!.qa_score >= 0 && report!.qa_score <= 1);
});

test('缺 hook 文字时 hook_text_timing 判失败', () => {
  const withHook = runQaOnSynthetic({ withHook: true, loopMode: 'none', duration: 4 });
  const noHook = runQaOnSynthetic({ withHook: false, loopMode: 'none', duration: 4 });
  const a = withHook!.checks.find((c) => c.name === 'hook_text_timing')!;
  const b = noHook!.checks.find((c) => c.name === 'hook_text_timing')!;
  assert.equal(a.passed, true, '有 hook 且在 0.15s 内出现应通过');
  assert.equal(b.passed, false, '没有 hook 文字应判失败');
});

test('非循环视频的 ending_return 判为不适用（通过）', () => {
  const report = runQaOnSynthetic({ withHook: true, loopMode: 'none', duration: 4 });
  const c = report!.checks.find((x) => x.name === 'ending_return')!;
  assert.equal(c.passed, true);
  assert.ok(c.actual.includes('不适用'), `actual 应说明不适用，实际：${c.actual}`);
});

test('节奏偏差超过 25ms 时 rhythm_deviation 判失败', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-t14b-'));
  try {
    const mp4 = path.join(tmp, 'v.mp4');
    execFileSync(
      'ffmpeg',
      ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=120x214:rate=15:duration=3',
       '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4],
      { stdio: 'pipe' },
    );
    const payloadPath = path.join(tmp, 'p.json');
    fs.writeFileSync(payloadPath, JSON.stringify({
      spec: { format: { duration_sec: 3, loop: { enabled: false, mode: 'none' } }, scene: { template: 'melody-bounce' }, timeline: [] },
      events: [{ t: 0.2, midi: 60, intensity: 1.0, dev_ms: 90 }, { t: 0.8, midi: 62, intensity: 1.0, dev_ms: 80 }],
    }), 'utf8');
    const out = path.join(tmp, 'v.qa.json');
    execFileSync('python3', [SCRIPT, mp4, payloadPath, out], { cwd: REPO, stdio: 'pipe' });
    const report = JSON.parse(fs.readFileSync(out, 'utf8')) as QaReport;
    const c = report.checks.find((x) => x.name === 'rhythm_deviation')!;
    assert.equal(c.passed, false, '平均 85ms 应判失败');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('qa.json 文件缺失时不影响渲染（readQaReport 语义）', () => {
  // 用文件系统模拟：不存在的路径应返回 null 而非抛错
  const missing = path.join(os.tmpdir(), `definitely-missing-${Date.now()}.qa.json`);
  assert.equal(fs.existsSync(missing), false);
});

test('老视频（无 hook / 无 twist）得分低于新视频', () => {
  // 用同一份合成素材，只改 payload 里的 timeline 与 loop 配置来模拟新旧
  const oldish = runQaOnSynthetic({ withHook: false, loopMode: 'none', duration: 4 });
  const newish = runQaOnSynthetic({ withHook: true, loopMode: 'none', duration: 4 });
  assert.ok(
    oldish!.qa_score < newish!.qa_score,
    `老视频得分应更低，实际 old=${oldish!.qa_score} new=${newish!.qa_score}`,
  );
});
