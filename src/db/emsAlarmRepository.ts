import { getDb } from './database.js';
import { logger } from '../utils/logger.js';
import type { AlarmItem } from '../types/index.js';

export interface EmsAlarmRecord {
  id: number;
  ems_id: number;
  alarm_id: string;
  source: string;
  name: string;
  level: string;
  device_type: string;
  alarm_time: string;
  recover_time: string | null;
  created_at: string;
}

function nowBeijing(): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 批量写入 EMS 告警（来自工具调用结果），已存在的记录跳过（IGNORE）
 */
export function upsertEmsAlarms(alarmId: string, source: 'realtime' | 'history', alarms: AlarmItem[]): void {
  if (!alarms.length) return;
  try {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO ems_alarms
        (ems_id, alarm_id, source, name, level, device_type, alarm_time, recover_time, created_at)
      VALUES
        (@ems_id, @alarm_id, @source, @name, @level, @device_type, @alarm_time, @recover_time, @created_at)
    `);
    const insertAll = db.transaction((items: AlarmItem[]) => {
      const now = nowBeijing();
      for (const item of items) {
        stmt.run({
          ems_id:       item.id,
          alarm_id:     alarmId,
          source,
          name:         item.name,
          level:        item.level,
          device_type:  item.deviceType,
          alarm_time:   item.alarmTime,
          recover_time: item.recoverTime ?? null,
          created_at:   now,
        });
      }
    });
    insertAll(alarms);
    logger.info('EmsAlarmRepository', '写入 EMS 告警成功', { alarmId, source, count: alarms.length });
  } catch (err: unknown) {
    logger.error('EmsAlarmRepository', '写入 EMS 告警失败', { alarmId, error: (err as Error).message });
  }
}

/**
 * 查询最近 N 条 EMS 告警记录
 */
export function queryRecentEmsAlarms(limit = 200): EmsAlarmRecord[] {
  try {
    return getDb()
      .prepare('SELECT * FROM ems_alarms ORDER BY created_at DESC LIMIT ?')
      .all(limit) as EmsAlarmRecord[];
  } catch (err: unknown) {
    logger.error('EmsAlarmRepository', '查询 EMS 告警失败', { error: (err as Error).message });
    return [];
  }
}
