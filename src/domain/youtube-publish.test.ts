import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * T15：发布模式的两个分支必须构造出互斥的 status 块。
 *
 * 官方约束（developers.google.com/youtube/v3/docs/videos）：
 *   - privacyStatus 不写时默认 public
 *   - "Videos uploaded from unverified API projects are not restricted to private viewing mode"
 *   - publishAt 只能在 privacyStatus=private 时设置
 *
 * 这里复刻 resumableUploadVideoToYoutube 里构造 status 的那段逻辑，
 * 断言 public 与 publishAt 永远不会同时出现。
 */

type Mode = { kind: 'public_now' } | { kind: 'scheduled'; publishAt: string };

/** 与 src/server/youtube.ts 里的构造逻辑保持一致 */
function buildStatus(
  mode: Mode,
  flags: { madeForKids: boolean; containsSyntheticMedia: boolean }
): Record<string, unknown> {
  const status: Record<string, unknown> = {
    selfDeclaredMadeForKids: flags.madeForKids,
    containsSyntheticMedia: flags.containsSyntheticMedia,
  };
  if (mode.kind === 'public_now') {
    status.privacyStatus = 'public';
  } else {
    const when = new Date(mode.publishAt);
    if (Number.isNaN(when.getTime())) {
      throw new Error(`publishAt 时间格式无效：${mode.publishAt}`);
    }
    status.privacyStatus = 'private';
    status.publishAt = when.toISOString();
  }
  return status;
}

const FLAGS = { madeForKids: false, containsSyntheticMedia: true };

test('publish_now 构造出 public，且不带 publishAt', () => {
  const st = buildStatus({ kind: 'public_now' }, FLAGS);
  assert.equal(st.privacyStatus, 'public');
  assert.equal(st.publishAt, undefined, 'public 模式下不能带 publishAt（YouTube 会报错）');
  assert.equal(st.selfDeclaredMadeForKids, false);
  assert.equal(st.containsSyntheticMedia, true);
});

test('scheduled 构造出 private + publishAt', () => {
  const at = '2026-11-16T03:00:00.000Z';
  const st = buildStatus({ kind: 'scheduled', publishAt: at }, FLAGS);
  assert.equal(st.privacyStatus, 'private', 'publishAt 只能在 private 下设置');
  assert.equal(st.publishAt, at);
});

test('两种模式的 privacyStatus 互斥：public 永不携带 publishAt', () => {
  for (const mode of [
    { kind: 'public_now' as const },
    { kind: 'scheduled' as const, publishAt: '2026-12-01T00:00:00.000Z' },
  ]) {
    const st = buildStatus(mode, FLAGS);
    const isPublic = st.privacyStatus === 'public';
    const hasPublishAt = st.publishAt !== undefined;
    assert.ok(
      !(isPublic && hasPublishAt),
      `public 与 publishAt 不能同时出现，实际：${JSON.stringify(st)}`
    );
  }
});

test('非法时间在构造阶段就抛错，不会发出坏请求', () => {
  assert.throws(
    () => buildStatus({ kind: 'scheduled', publishAt: 'not-a-date' }, FLAGS),
    /publishAt 时间格式无效/
  );
});

test('publishAt 会被规范化成 ISO 字符串', () => {
  const st = buildStatus({ kind: 'scheduled', publishAt: '2026-11-16T11:00:00+08:00' }, FLAGS);
  assert.equal(st.publishAt, '2026-11-16T03:00:00.000Z', '带时区的时间应转成 UTC ISO');
});

/**
 * 定时发布（private + publishAt）在到点前是私享，
 * 提前发首评会挂在一条用户看不见的视频下，所以不发。
 */
test('定时模式不应提前发首评，立即公开模式才发', () => {
  const shouldPostFirstComment = (state: string, hasComment: boolean, posted: boolean) =>
    state !== 'scheduled' && hasComment && !posted;

  assert.equal(shouldPostFirstComment('scheduled', true, false), false, '定时模式不发首评');
  assert.equal(shouldPostFirstComment('published', true, false), true, '已公开则发首评');
  assert.equal(shouldPostFirstComment('published', true, true), false, '已发过不重发');
  assert.equal(shouldPostFirstComment('scheduled', false, false), false, '没首评内容不发');
});
