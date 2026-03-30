import axios from 'axios';
import type { TelemetryData } from '../types/index.js';

const EMS_BASE_URL = process.env['EMS_BASE_URL'] ?? 'http://localhost:8080';

/**
 * 调通历史接口，打印返回值
 * 确认历史数据接口 URL 和时间参数格式
 */
export async function queryHistory(args: { fields: string[]; hours: number; deviceId?: string }): Promise<TelemetryData[]> {
  try {
    const response = await axios.get(`${EMS_BASE_URL}/api/history`, {
      params: {
        fields: args.fields.join(','),
        hours: args.hours,
        deviceId: args.deviceId,
      },
    });
    console.log('[Tools] queryHistory 返回值:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error: unknown) {
    console.error('[Tools] queryHistory 失败:', (error as Error).message);
    throw error;
  }
}
