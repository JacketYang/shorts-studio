import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  formatOffset,
  getOffsetMinutes,
  timezoneOffsetLabel,
  utcToZonedWallTime,
  zonedWallTimeToUtc,
} from './timezone.ts';

test('默认时区是 UTC+8', () => {
  assert.equal(DEFAULT_TIMEZONE, 'Asia/Shanghai');
  assert.equal(timezoneOffsetLabel('Asia/Shanghai'), 'UTC+8');
});

test('常用时区清单里的 id 都是 Intl 认得的 IANA 名', () => {
  assert.ok(COMMON_TIMEZONES.length >= 15, '应覆盖主要时区');
  for (const tz of COMMON_TIMEZONES) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: tz.id }),
      `${tz.id} 不是合法 IANA 时区`
    );
  }
  // 第一项是默认时区
  assert.equal(COMMON_TIMEZONES[0].id, DEFAULT_TIMEZONE);
});

test('墙上时间按所选时区换算成 UTC', () => {
  const cases: Array<[string, string, string]> = [
    ['2026-11-16T09:00', 'Asia/Shanghai', '2026-11-16T01:00:00.000Z'],
    ['2026-11-16T09:00', 'UTC', '2026-11-16T09:00:00.000Z'],
    ['2026-11-16T09:00', 'Asia/Tokyo', '2026-11-16T00:00:00.000Z'],
    ['2026-11-16T09:00', 'Europe/London', '2026-11-16T09:00:00.000Z'],
  ];
  for (const [wall, tz, expect] of cases) {
    assert.equal(zonedWallTimeToUtc(wall, tz)?.toISOString(), expect, `${tz} ${wall}`);
  }
});

test('半小时时区（印度 UTC+5:30）换算正确', () => {
  assert.equal(
    zonedWallTimeToUtc('2026-11-16T09:00', 'Asia/Kolkata')?.toISOString(),
    '2026-11-16T03:30:00.000Z'
  );
  assert.equal(formatOffset(getOffsetMinutes('Asia/Kolkata')), 'UTC+5:30');
});

test('夏令时两侧偏移不同，但往返换算都不漂移', () => {
  // 纽约：7 月 EDT = UTC-4，11 月 EST = UTC-5
  const summer = zonedWallTimeToUtc('2026-07-16T09:00', 'America/New_York');
  const winter = zonedWallTimeToUtc('2026-11-16T09:00', 'America/New_York');
  assert.equal(summer?.toISOString(), '2026-07-16T13:00:00.000Z', 'EDT 应为 UTC-4');
  assert.equal(winter?.toISOString(), '2026-11-16T14:00:00.000Z', 'EST 应为 UTC-5');

  assert.equal(utcToZonedWallTime(summer!, 'America/New_York'), '2026-07-16T09:00');
  assert.equal(utcToZonedWallTime(winter!, 'America/New_York'), '2026-11-16T09:00');
});

test('墙上时间 → UTC → 墙上时间，往返不漂移', () => {
  for (const tz of ['Asia/Shanghai', 'America/New_York', 'Asia/Kolkata', 'UTC', 'Pacific/Auckland']) {
    for (const wall of ['2026-01-05T00:00', '2026-06-15T12:34', '2026-12-31T23:59']) {
      const utc = zonedWallTimeToUtc(wall, tz);
      assert.ok(utc, `${tz} ${wall} 应能换算`);
      assert.equal(utcToZonedWallTime(utc!, tz), wall, `${tz} ${wall} 往返漂移`);
    }
  }
});

test('非法输入返回 null，不抛错', () => {
  assert.equal(zonedWallTimeToUtc('not-a-time', 'Asia/Shanghai'), null);
  assert.equal(zonedWallTimeToUtc('2026-11-16', 'Asia/Shanghai'), null);
  assert.equal(zonedWallTimeToUtc('', 'Asia/Shanghai'), null);
});

test('偏移标签格式正确', () => {
  assert.equal(formatOffset(480), 'UTC+8');
  assert.equal(formatOffset(-300), 'UTC-5');
  assert.equal(formatOffset(330), 'UTC+5:30');
  assert.equal(formatOffset(0), 'UTC+0');
  assert.equal(formatOffset(-210), 'UTC-3:30');
});
