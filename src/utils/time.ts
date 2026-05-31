/**
 * 时间窗口工具 —— 统一处理「alarm_records.started_at 以北京时间 +08:00 存储」这一约定。
 *
 * 背景（见 llm-ai/error-api-时区-2026-06-01.md）：
 * started_at 由 alarmRepository.nowBeijing() 写入，形如
 *   2026-06-01T08:00:00.000+08:00   （带显式 +08:00 偏移）
 * SQLite 的 datetime()/julianday()/strftime() 都会按该偏移自动归一到 UTC。因此：
 *   - 求 hours_ago：直接 (julianday('now') - julianday(started_at)) * 24，
 *     不能再 datetime(started_at,'-8 hours')——那会在已归一的 UTC 上再减 8h（多偏 8 小时）。
 *   - 取北京小时：strftime('%H', started_at, '+8 hours')（先归一 UTC 再 +8 = 北京）。
 *   - 时间窗过滤：用同为 +08:00 字符串的 cutoff 做 `started_at >= ?` 比较——
 *     与 started_at 同格式（ISO 字典序=时序）、可命中 started_at 索引，
 *     且避免与 datetime('now')（UTC、格式不同）做字典序比较导致的窗口偏移。
 */

/**
 * 收敛对外暴露的 hours 窗口参数为安全正整数。
 * 防御 NaN / 负数 / 0 / 超大值——这些会让 `datetime('now','-N hours')` 退化或报错，
 * 也会让补桶循环产生 0 个或过多的格子。
 */
export function clampHours(hours: unknown, def = 24, max = 168): number {
  const n = Math.floor(Number(hours));
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(n, max);
}

/**
 * 返回「hours 小时前」的北京时间字符串（+08:00 格式），
 * 专用于与 started_at 同格式比较：`WHERE started_at >= ?`。
 */
export function beijingCutoffHours(hours: number): string {
  return new Date(Date.now() + 8 * 3600000 - hours * 3600000)
    .toISOString()
    .replace('Z', '+08:00');
}
