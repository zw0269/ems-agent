import type { Violation } from '../types/index.js';

/**
 * 正常运行阈值（字段名对应真实 API 返回的 key）
 * HomePageData 字段：batterySOC, batteryVoltage, batteryCurrent
 * PCS yc 字段：gridFrequency, pcsInsulationresistance, pcsLeakageCurrent
 */
export const NORMAL_THRESHOLDS: Record<string, { max?: number; min?: number; unit: string }> = {
  // BMS
  batterySOC:            { min: 5,    max: 100,  unit: '%'  },
  batteryVoltage:        { min: 700,  max: 1050, unit: 'V'  },
  // PCS 遥测（来自 getPcsYc）
  gridFrequency:         { min: 49.5, max: 50.5, unit: 'Hz' },
  pcsInsulationresistance: { min: 100,           unit: 'kΩ' },
  pcsLeakageCurrent:     {            max: 1.0,  unit: 'A'  },
  // 温度
  pcsOutletAirTemp:      {            max: 75,   unit: '℃'  },
  pcsTempPhaseA:         {            max: 80,   unit: '℃'  },
  pcsTempPhaseB:         {            max: 80,   unit: '℃'  },
  pcsTempPhaseC:         {            max: 80,   unit: '℃'  },
  moduleTemperatureMax:  {            max: 60,   unit: '℃'  },
};

/**
 * 检查实时快照中的越限项
 * 输入为由真实 API 数据构建的扁平对象
 */
export function checkThresholds(realtime: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  const timestamp = (realtime['timestamp'] as string | undefined) ?? new Date().toISOString();

  for (const [key, threshold] of Object.entries(NORMAL_THRESHOLDS)) {
    const val = realtime[key];
    if (val === undefined || val === null || typeof val !== 'number') continue;

    let isViolation = false;
    let message = '';

    if (threshold.max !== undefined && val > threshold.max) {
      isViolation = true;
      message = `${key} (${val}${threshold.unit}) 超过上限 ${threshold.max}${threshold.unit}`;
    } else if (threshold.min !== undefined && val < threshold.min) {
      isViolation = true;
      message = `${key} (${val}${threshold.unit}) 低于下限 ${threshold.min}${threshold.unit}`;
    }

    if (isViolation) {
      violations.push({ field: key, value: val, threshold, message, timestamp });
    }
  }

  return violations;
}
