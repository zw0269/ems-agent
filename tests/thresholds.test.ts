import { describe, it, expect } from 'vitest';
import { checkThresholds } from '../src/config/thresholds.js';

describe('checkThresholds 阈值判定', () => {
  it('正常数据无越限', () => {
    const v = checkThresholds({
      batterySOC: 60,
      batteryVoltage: 800,
      gridFrequency: 50.0,
      pcsLeakageCurrent: 0.3,
      pcsInsulationresistance: 500,
    });
    expect(v).toHaveLength(0);
  });

  it('SOC 低于下限时命中', () => {
    const v = checkThresholds({ batterySOC: 3 });
    expect(v).toHaveLength(1);
    expect(v[0]?.field).toBe('batterySOC');
    expect(v[0]?.message).toMatch(/低于下限/);
  });

  it('电池总压高于上限时命中', () => {
    const v = checkThresholds({ batteryVoltage: 1100 });
    expect(v).toHaveLength(1);
    expect(v[0]?.field).toBe('batteryVoltage');
    expect(v[0]?.message).toMatch(/超过上限/);
  });

  it('电网频率越限时命中（上下限各一）', () => {
    expect(checkThresholds({ gridFrequency: 49.3 })[0]?.message).toMatch(/低于下限/);
    expect(checkThresholds({ gridFrequency: 50.6 })[0]?.message).toMatch(/超过上限/);
  });

  it('非数值字段（string/null/undefined）被忽略', () => {
    const v = checkThresholds({
      batterySOC: null,
      batteryVoltage: 'oops' as any,
      gridFrequency: undefined,
    });
    expect(v).toHaveLength(0);
  });

  it('多个字段同时越限时全部返回', () => {
    const v = checkThresholds({
      batterySOC: 2,
      gridFrequency: 48,
      pcsLeakageCurrent: 2.5,
    });
    expect(v).toHaveLength(3);
    const fields = v.map(x => x.field).sort();
    expect(fields).toEqual(['batterySOC', 'gridFrequency', 'pcsLeakageCurrent']);
  });
});
