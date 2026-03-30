import axios from 'axios';
import type { Alarm, AlarmItem, TelemetryData } from '../types/index.js';
import { logger } from '../utils/logger.js';

const EMS_BASE_URL = process.env['EMS_BASE_URL'] ?? 'http://localhost:8080';

/**
 * deviceType → faultCategory 映射
 * BMS / DCDC 为硬件设备；PCS / Meter 为软件/电气逻辑
 */
function toFaultCategory(deviceType: string): 'hardware' | 'software' {
  const hw = ['Bms', 'BMS', 'Dcdc', 'DCDC'];
  return hw.includes(deviceType) ? 'hardware' : 'software';
}

/**
 * 告警等级（level 字符串）→ AlarmPriority
 */
function toAlarmPriority(level: string): 'P0' | 'P1' | 'P2' | 'P3' {
  const map: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {
    '0': 'P0', '1': 'P1', '2': 'P2', '3': 'P3',
  };
  return map[level] ?? 'P2';
}

/**
 * 从 EMS 实时告警接口拉取当前活跃告警，转换为 Agent 内部 Alarm 格式
 * GET /grid-ems/AlarmAndEvent/realTimeAlarm/list
 */
export async function fetchAlarms(): Promise<Alarm[]> {
  const t0 = Date.now();
  logger.info('QueryBms', '拉取实时告警列表', { url: `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/realTimeAlarm/list` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: { list: AlarmItem[] } }>(
      `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/realTimeAlarm/list`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const raw = response.data.data.list;
    const alarms: Alarm[] = raw.map(item => ({
      alarmId:       String(item.id),
      alarmType:     item.name,
      faultCategory: toFaultCategory(item.deviceType),
      deviceId:      item.deviceType,
      timestamp:     item.alarmTime,
      priority:      toAlarmPriority(item.level),
    }));

    logger.info('QueryBms', '实时告警拉取完成', {
      count: alarms.length,
      durationMs: Date.now() - t0,
    });
    return alarms;
  } catch (err: unknown) {
    logger.error('QueryBms', '实时告警拉取失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 查询实时遥测数据
 * GET /api/telemetry（占位，按需替换为真实端点）
 */
export async function queryBms(args: { fields: string[]; deviceId?: string }): Promise<TelemetryData> {
  const t0 = Date.now();
  try {
    const response = await axios.get(`${EMS_BASE_URL}/api/telemetry`, {
      params: { fields: args.fields.join(','), deviceId: args.deviceId },
    });
    logger.info('QueryBms', 'queryBms 成功', { durationMs: Date.now() - t0 });
    return response.data;
  } catch (err: unknown) {
    logger.error('QueryBms', 'queryBms 失败', { error: (err as Error).message, durationMs: Date.now() - t0 });
    throw err;
  }
}
