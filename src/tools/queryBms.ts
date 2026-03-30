import axios from 'axios';
import type { Alarm, TelemetryData } from '../types/index.js';

const EMS_BASE_URL = process.env.EMS_BASE_URL || 'http://localhost:8080';

/**
 * 调通 Java 告警接口，打印返回值
 * 验证字段：alarmId, alarmType, faultCategory, deviceId, timestamp
 */
export async function fetchAlarms(): Promise<Alarm[]> {
  try {
    const response = await axios.get(`${EMS_BASE_URL}/api/alarms`);
    console.log('[Tools] fetchAlarms 返回值:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('[Tools] fetchAlarms 失败:', (error as Error).message);
    throw error;
  }
}

/**
 * 调通实时遥测接口，打印返回值
 * 参数格式：fields 如何传递（query string / body）
 */
export async function queryBms(args: { fields: string[]; deviceId?: string }): Promise<TelemetryData> {
  try {
    // 假设使用 query string 传递 fields，用逗号分隔
    const response = await axios.get(`${EMS_BASE_URL}/api/telemetry`, {
      params: {
        fields: args.fields.join(','),
        deviceId: args.deviceId,
      },
    });
    console.log('[Tools] queryBms 返回值:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('[Tools] queryBms 失败:', (error as Error).message);
    throw error;
  }
}
