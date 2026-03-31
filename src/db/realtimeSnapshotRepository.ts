import { getDb } from './database.js';
import { logger } from '../utils/logger.js';

export interface RealtimeSnapshotRecord {
  id: number;
  alarm_id: string;
  snapshot_json: string;
  captured_at: string;
}

function nowBeijing(): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 保存告警触发时采集的实时设备快照
 */
export function insertRealtimeSnapshot(alarmId: string, snapshot: Record<string, unknown>): void {
  try {
    getDb().prepare(`
      INSERT INTO realtime_snapshots (alarm_id, snapshot_json, captured_at)
      VALUES (@alarm_id, @snapshot_json, @captured_at)
    `).run({
      alarm_id:      alarmId,
      snapshot_json: JSON.stringify(snapshot),
      captured_at:   nowBeijing(),
    });
  } catch (err: unknown) {
    logger.error('RealtimeSnapshotRepository', '写入实时快照失败', {
      alarmId,
      error: (err as Error).message,
    });
  }
}

/**
 * 查询某次告警的实时快照
 */
export function queryRealtimeSnapshotByAlarm(alarmId: string): RealtimeSnapshotRecord | undefined {
  try {
    return getDb()
      .prepare('SELECT * FROM realtime_snapshots WHERE alarm_id = ? ORDER BY id DESC LIMIT 1')
      .get(alarmId) as RealtimeSnapshotRecord | undefined;
  } catch (err: unknown) {
    logger.error('RealtimeSnapshotRepository', '查询实时快照失败', { error: (err as Error).message });
    return undefined;
  }
}
