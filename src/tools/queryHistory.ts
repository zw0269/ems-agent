import { getHistoryAlarms } from './queryEms.js';
import { logger } from '../utils/logger.js';

/**
 * 查询历史告警记录（替代原占位 /api/history 接口）
 * 根据 hours 参数计算时间范围，调用真实历史告警接口
 */
export async function queryHistory(args: { fields?: string[]; hours?: number; deviceId?: string }) {
  const hours = args.hours ?? 24;
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
  const endTime   = fmt(now);
  const startTime = fmt(new Date(now.getTime() - hours * 60 * 60 * 1000));

  logger.info('QueryHistory', '查询历史告警（替代历史遥测）', {
    hours,
    startTime,
    endTime,
    deviceId: args.deviceId,
  });

  const alarms = await getHistoryAlarms({ startTime, endTime });

  // 若指定了 deviceId，按 deviceType 过滤
  if (args.deviceId) {
    return alarms.filter(a =>
      a.deviceType.toLowerCase().includes(args.deviceId!.toLowerCase())
    );
  }
  return alarms;
}
