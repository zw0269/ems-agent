import { getDb } from './database.js';
import { logger } from '../utils/logger.js';
import type { Alarm } from '../types/index.js';

export interface AlarmRecord {
  id: number;
  alarm_id: string;
  alarm_type: string;
  fault_category: string;
  device_id: string;
  priority: string;
  alarm_timestamp: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: 'processing' | 'done' | 'error';
  conclusion: string | null;
  is_test: number;  // 0 = 自动, 1 = 手动测试
}

function nowBeijing(): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 将任意时间字符串统一转为北京时间格式 YYYY-MM-DDTHH:mm:ss.sss+08:00
 * 支持：
 *   - ISO UTC 字符串（2026-03-30T08:27:19.967Z）
 *   - 已有 +08:00 的字符串（直接返回）
 *   - 无时区的字符串（2026-03-29 11:23:27，视为北京时间）
 */
function toBeijingTimestamp(raw: string): string {
  if (raw.includes('+08:00')) return raw;
  // "YYYY-MM-DD HH:mm:ss" → 视为北京时间，补 +08:00
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) {
    return raw.replace(' ', 'T') + '+08:00';
  }
  // UTC ISO 字符串 → 转换偏移
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(new Date(raw).getTime() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 告警开始处理时写入记录（status = processing）
 */
export function insertAlarm(alarm: Alarm, isTest = false): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO alarm_records
        (alarm_id, alarm_type, fault_category, device_id, priority, alarm_timestamp, started_at, status, is_test)
      VALUES
        (@alarm_id, @alarm_type, @fault_category, @device_id, @priority, @alarm_timestamp, @started_at, 'processing', @is_test)
    `).run({
      alarm_id:        alarm.alarmId,
      alarm_type:      alarm.alarmType,
      fault_category:  alarm.faultCategory,
      device_id:       alarm.deviceId,
      priority:        alarm.priority,
      alarm_timestamp: toBeijingTimestamp(alarm.timestamp),
      started_at:      nowBeijing(),
      is_test:         isTest ? 1 : 0,
    });
  } catch (err: unknown) {
    logger.error('AlarmRepository', '写入告警记录失败', { alarmId: alarm.alarmId, error: (err as Error).message });
  }
}

/**
 * 告警处理完成时更新结论、状态、耗时
 */
export function updateAlarmFinished(
  alarmId: string,
  conclusion: string,
  isError: boolean,
  durationMs: number,
): void {
  try {
    const db = getDb();
    db.prepare(`
      UPDATE alarm_records
      SET
        finished_at  = @finished_at,
        duration_ms  = @duration_ms,
        status       = @status,
        conclusion   = @conclusion
      WHERE alarm_id = @alarm_id
    `).run({
      alarm_id:    alarmId,
      finished_at: nowBeijing(),
      duration_ms: durationMs,
      status:      isError ? 'error' : 'done',
      conclusion,
    });
  } catch (err: unknown) {
    logger.error('AlarmRepository', '更新告警记录失败', { alarmId, error: (err as Error).message });
  }
}

/**
 * 查询最近 N 条告警记录（默认 50）
 */
export function queryRecentAlarms(limit = 50): AlarmRecord[] {
  try {
    return getDb()
      .prepare('SELECT * FROM alarm_records ORDER BY started_at DESC LIMIT ?')
      .all(limit) as AlarmRecord[];
  } catch (err: unknown) {
    logger.error('AlarmRepository', '查询告警记录失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 按时间范围查询（北京时间字符串，格式 YYYY-MM-DD 或 YYYY-MM-DDTHH:mm）
 */
export function queryAlarmsByRange(startAt: string, endAt: string): AlarmRecord[] {
  try {
    return getDb()
      .prepare(`
        SELECT * FROM alarm_records
        WHERE started_at >= ? AND started_at <= ?
        ORDER BY started_at DESC
      `)
      .all(startAt, endAt) as AlarmRecord[];
  } catch (err: unknown) {
    logger.error('AlarmRepository', '按范围查询告警记录失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 查询单条告警详情
 */
export function queryAlarmById(alarmId: string): AlarmRecord | undefined {
  try {
    return getDb()
      .prepare('SELECT * FROM alarm_records WHERE alarm_id = ?')
      .get(alarmId) as AlarmRecord | undefined;
  } catch (err: unknown) {
    logger.error('AlarmRepository', '查询单条告警失败', { alarmId, error: (err as Error).message });
    return undefined;
  }
}

/**
 * 查询最近 N 小时内每小时的告警数量（用于趋势图）
 * 返回 [{hour: 'HH:00', count: N}, ...]，最近 hours 个小时
 */
export function queryAlarmTrend(hours = 24): Array<{ hour: string; count: number }> {
  try {
    const rows = getDb().prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:00', datetime(started_at, '-8 hours')) AS hour_utc,
        COUNT(*) AS count
      FROM alarm_records
      WHERE started_at >= datetime('now', '-${hours} hours')
      GROUP BY hour_utc
      ORDER BY hour_utc ASC
    `).all() as Array<{ hour_utc: string; count: number }>;

    // 补全所有小时格（无数据的补 0）
    const now = Date.now();
    const result: Array<{ hour: string; count: number }> = [];
    const countMap = new Map(rows.map(r => [r.hour_utc, r.count]));
    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(now - i * 3600000);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}T${String(d.getUTCHours()).padStart(2,'0')}:00`;
      const label = `${String((d.getUTCHours() + 8) % 24).padStart(2,'0')}:00`;
      result.push({ hour: label, count: countMap.get(key) ?? 0 });
    }
    return result;
  } catch (err: unknown) {
    logger.error('AlarmRepository', '查询告警趋势失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * R2 崩溃恢复：将 >staleMinutes 仍处于 processing 的告警强制置 error
 * 启动时调用一次，避免进程崩溃导致记录永远卡在 processing
 * 返回被修复的告警数量
 */
export function recoverStaleProcessingAlarms(staleMinutes = 5): number {
  try {
    const db = getDb();
    // 以北京时间字符串比较：当前时刻减 staleMinutes
    const cutoffBeijing = new Date(Date.now() + 8 * 3600000 - staleMinutes * 60000)
      .toISOString()
      .replace('Z', '+08:00');

    const result = db.prepare(`
      UPDATE alarm_records
      SET
        status      = 'error',
        finished_at = @finished_at,
        conclusion  = COALESCE(conclusion, '[Recovery] 进程中断或重启，告警强制标记为 error。请检查日志复盘。')
      WHERE status = 'processing'
        AND started_at < @cutoff
    `).run({
      finished_at: nowBeijing(),
      cutoff:      cutoffBeijing,
    });

    const changed = result.changes ?? 0;
    if (changed > 0) {
      logger.warn('AlarmRepository', 'R2 恢复：将滞留 processing 告警置 error', {
        count: changed,
        staleMinutes,
      });
    }
    return changed;
  } catch (err: unknown) {
    logger.error('AlarmRepository', 'R2 恢复扫描失败', { error: (err as Error).message });
    return 0;
  }
}

/**
 * R2 对账：核对告警终态分布
 * 外部可对比 Source（心跳拉到的 ems_alarms count）== done + error + processing
 */
export function reconcileAlarmStates(sinceHours = 24): {
  total: number;
  done: number;
  error: number;
  processing: number;
  sinceHours: number;
  balanced: boolean;
} {
  try {
    const row = getDb().prepare(`
      SELECT
        COUNT(*)                                                     AS total,
        SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END)         AS done,
        SUM(CASE WHEN status='error'      THEN 1 ELSE 0 END)         AS error,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END)         AS processing
      FROM alarm_records
      WHERE started_at >= datetime('now', '-${sinceHours} hours')
    `).get() as { total: number; done: number; error: number; processing: number };

    return {
      ...row,
      sinceHours,
      balanced: row.total === (row.done + row.error + row.processing),
    };
  } catch {
    return { total: 0, done: 0, error: 0, processing: 0, sinceHours, balanced: false };
  }
}

/**
 * E6 延时分位统计：按告警类型聚合 P50/P95/P99，用于 SLA 监控
 * 仅统计已完成告警（duration_ms 非空）
 */
export function queryAlarmLatencyPercentiles(sinceHours = 24): Array<{
  alarmType: string;
  count: number;
  p50: number;
  p95: number;
  p99: number;
}> {
  try {
    const rows = getDb().prepare(`
      SELECT alarm_type AS alarmType, duration_ms
      FROM alarm_records
      WHERE duration_ms IS NOT NULL
        AND started_at >= datetime('now', '-${sinceHours} hours')
      ORDER BY alarm_type, duration_ms ASC
    `).all() as Array<{ alarmType: string; duration_ms: number }>;

    const groups = new Map<string, number[]>();
    for (const r of rows) {
      if (!groups.has(r.alarmType)) groups.set(r.alarmType, []);
      groups.get(r.alarmType)!.push(r.duration_ms);
    }

    const pick = (sorted: number[], p: number) => {
      if (sorted.length === 0) return 0;
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
      return sorted[idx] ?? 0;
    };

    return Array.from(groups.entries()).map(([alarmType, durations]) => ({
      alarmType,
      count: durations.length,
      p50: pick(durations, 0.50),
      p95: pick(durations, 0.95),
      p99: pick(durations, 0.99),
    })).sort((a, b) => b.count - a.count);
  } catch (err: unknown) {
    logger.error('AlarmRepository', '查询告警延时分位失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 统计各状态数量
 */
export function queryStats(): { total: number; done: number; error: number; processing: number } {
  try {
    const row = getDb().prepare(`
      SELECT
        COUNT(*)                                     AS total,
        SUM(CASE WHEN status='done'       THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status='error'      THEN 1 ELSE 0 END) AS error,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) AS processing
      FROM alarm_records
    `).get() as { total: number; done: number; error: number; processing: number };
    return row;
  } catch {
    return { total: 0, done: 0, error: 0, processing: 0 };
  }
}
