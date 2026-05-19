import crypto from 'crypto';
import type { Alarm } from '../types/index.js';

/**
 * 告警指纹计算
 *
 * 第一性：同一物理事件常常在短时间内多次推送（PCS 总故障 → BMS 联动告警 → 通讯告警），
 *        如果每条都跑完整 LLM 分析，成本巨大且推送淹没运维注意力。
 *
 * fingerprint = hash(alarmType + deviceId + floor(timestamp / bucket))
 *
 * - bucket 默认 5 分钟：同设备同类型 5 分钟内归为同一指纹
 * - timestamp 用告警时间（而非接收时间），避免被入队延迟干扰
 * - 用 sha256 前 16 hex 字符（64 bit），冲突概率可忽略
 */

export const FINGERPRINT_BUCKET_MINUTES = 5;

/**
 * 把告警时间归一化到 bucket 起始时刻
 * 例：timestamp='2026-05-19 09:42:44', bucket=5min → 2026-05-19T09:40:00
 */
function alignToBucket(timestamp: string, bucketMinutes: number): string {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return timestamp; // 解析失败兜底用原值，仍能稳定 hash
  const bucketMs = bucketMinutes * 60 * 1000;
  const aligned = Math.floor(ms / bucketMs) * bucketMs;
  return new Date(aligned).toISOString();
}

export function computeFingerprint(alarm: Alarm, bucketMinutes = FINGERPRINT_BUCKET_MINUTES): string {
  const bucket = alignToBucket(alarm.timestamp, bucketMinutes);
  const key = `${alarm.alarmType}|${alarm.deviceId}|${bucket}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}
