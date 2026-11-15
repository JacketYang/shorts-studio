/**
 * 时区工具：把「某个时区里的墙上时间」转成 UTC 瞬间。
 *
 * 为什么需要它：HTML 的 datetime-local 只能表达"浏览器本地时区的墙上时间"，
 * 无法表达"我指的是 America/New_York 的 9:00"。而 YouTube Studio 允许直接选时区，
 * 这里补齐同样的能力。
 *
 * 只用 Intl API，不引第三方库。
 */

/**
 * 常用时区清单（按使用频率排序，YouTube Studio 里也是这么排的）。
 * 值必须是 IANA 时区名，Intl 才认得。
 */
export const COMMON_TIMEZONES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'Asia/Shanghai', label: '中国标准时间 · 北京 (UTC+8)' },
  { id: 'Asia/Hong_Kong', label: '香港 (UTC+8)' },
  { id: 'Asia/Taipei', label: '台北 (UTC+8)' },
  { id: 'Asia/Tokyo', label: '日本 · 东京 (UTC+9)' },
  { id: 'Asia/Seoul', label: '韩国 · 首尔 (UTC+9)' },
  { id: 'Asia/Singapore', label: '新加坡 (UTC+8)' },
  { id: 'Asia/Bangkok', label: '泰国 · 曼谷 (UTC+7)' },
  { id: 'Asia/Kolkata', label: '印度 (UTC+5:30)' },
  { id: 'Asia/Dubai', label: '阿联酋 · 迪拜 (UTC+4)' },
  { id: 'Europe/London', label: '英国 · 伦敦' },
  { id: 'Europe/Paris', label: '中欧 · 巴黎' },
  { id: 'Europe/Berlin', label: '中欧 · 柏林' },
  { id: 'Europe/Moscow', label: '俄罗斯 · 莫斯科' },
  { id: 'America/New_York', label: '美国东部 · 纽约' },
  { id: 'America/Chicago', label: '美国中部 · 芝加哥' },
  { id: 'America/Denver', label: '美国山地 · 丹佛' },
  { id: 'America/Los_Angeles', label: '美国太平洋 · 洛杉矶' },
  { id: 'America/Sao_Paulo', label: '巴西 · 圣保罗' },
  { id: 'Australia/Sydney', label: '澳洲 · 悉尼' },
  { id: 'Pacific/Auckland', label: '新西兰 · 奥克兰' },
  { id: 'UTC', label: '协调世界时 (UTC)' },
];

/** 默认时区：UTC+8 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 某时区在指定瞬间的 UTC 偏移（分钟）。 */
export function getOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  // asUtc 是"把该时区的墙上时间当作 UTC"得到的毫秒数，
  // 与真实瞬间的差就是偏移量（秒级精度，够用）
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** 把偏移分钟格式化成 UTC+8 / UTC-5 / UTC+5:30 这样的标签。 */
export function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

/**
 * 把「某时区的墙上时间」转成真实 UTC 瞬间。
 *
 * @param wallTime 'YYYY-MM-DDTHH:mm' 形式（与 datetime-local 的 value 一致）
 * @param timeZone IANA 时区名
 * @returns Date；输入非法时返回 null
 */
export function zonedWallTimeToUtc(wallTime: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(wallTime.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? '0')
  );
  if (Number.isNaN(naive)) return null;

  // 先用该瞬间的偏移做一次估算，再用估算结果重算偏移，处理 DST 边界
  const guessOffset = getOffsetMinutes(timeZone, new Date(naive));
  let utc = naive - guessOffset * 60_000;
  const refinedOffset = getOffsetMinutes(timeZone, new Date(utc));
  if (refinedOffset !== guessOffset) {
    utc = naive - refinedOffset * 60_000;
  }
  const result = new Date(utc);
  return Number.isNaN(result.getTime()) ? null : result;
}

/**
 * 反向：把一个 UTC 瞬间显示成某时区的墙上时间字符串（供回填输入框）。
 */
export function utcToZonedWallTime(instant: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** 该时区当前的 UTC 偏移标签，例如 "UTC+8"。 */
export function timezoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  return formatOffset(getOffsetMinutes(timeZone, at));
}
