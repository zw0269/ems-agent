import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '../src/runtime/alarmFingerprint.js';
import type { Alarm } from '../src/types/index.js';

const baseAlarm: Alarm = {
  alarmId: 'TEST-1',
  alarmType: 'VF离网',
  deviceId: 'PCS01',
  priority: 'P1',
  faultCategory: 'software',
  timestamp: '2026-05-19 09:00:00',
};

describe('computeFingerprint', () => {
  it('同 alarmType + deviceId + 同 5 分钟桶 → 相同指纹', () => {
    const a = computeFingerprint({ ...baseAlarm, alarmId: 'A', timestamp: '2026-05-19 09:00:10' });
    const b = computeFingerprint({ ...baseAlarm, alarmId: 'B', timestamp: '2026-05-19 09:04:55' });
    expect(a).toBe(b);
  });

  it('跨 5 分钟桶 → 不同指纹', () => {
    const a = computeFingerprint({ ...baseAlarm, timestamp: '2026-05-19 09:00:00' });
    const b = computeFingerprint({ ...baseAlarm, timestamp: '2026-05-19 09:05:30' });
    expect(a).not.toBe(b);
  });

  it('不同 alarmType → 不同指纹', () => {
    const a = computeFingerprint({ ...baseAlarm, alarmType: 'VF离网' });
    const b = computeFingerprint({ ...baseAlarm, alarmType: '总故障状态' });
    expect(a).not.toBe(b);
  });

  it('不同 deviceId → 不同指纹', () => {
    const a = computeFingerprint({ ...baseAlarm, deviceId: 'PCS01' });
    const b = computeFingerprint({ ...baseAlarm, deviceId: 'PCS02' });
    expect(a).not.toBe(b);
  });

  it('非法 timestamp → 仍稳定返回固定值（不抛错）', () => {
    const a = computeFingerprint({ ...baseAlarm, timestamp: 'invalid' });
    const b = computeFingerprint({ ...baseAlarm, timestamp: 'invalid' });
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('指纹长度恒为 16 hex 字符', () => {
    const fp = computeFingerprint(baseAlarm);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });
});
