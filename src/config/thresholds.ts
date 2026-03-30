import type { TelemetryData, Violation } from '../types/index.js';

/**
 * 正常运行阈值定义 (NORMAL_THRESHOLDS)
 * 参考储能系统磷酸铁锂电池标准手册
 */
export const NORMAL_THRESHOLDS = {
  'bms_max_cell_voltage': { max: 3.65, min: 2.8, unit: 'V' },
  'bms_min_cell_voltage': { max: 3.65, min: 2.8, unit: 'V' },
  'bms_max_temp': { max: 55, min: 0, unit: '℃' },
  'bms_min_temp': { max: 55, min: 0, unit: '℃' },
  'bms_soc': { max: 100, min: 5, unit: '%' },
  'bms_insulation_res': { min: 100, unit: 'kΩ' },
  'pcs_dc_voltage': { max: 1000, min: 600, unit: 'V' },
  'pcs_grid_freq': { max: 50.5, min: 49.5, unit: 'Hz' },
};

/**
 * 确定性阈值检测
 * 越界数据标注时间，不走 LLM，直接输出结果
 */
export function checkThresholds(realtime: TelemetryData): Violation[] {
  const violations: Violation[] = [];
  const timestamp = realtime.timestamp || new Date().toISOString();

  for (const [key, threshold] of Object.entries(NORMAL_THRESHOLDS)) {
    const val = realtime[key];
    if (val === undefined || val === null) continue;

    let isViolation = false;
    let message = '';

    if ('max' in threshold && val > threshold.max) {
      isViolation = true;
      message = `${key} (${val}${threshold.unit}) 超过上限 ${threshold.max}${threshold.unit}`;
    } else if ('min' in threshold && val < threshold.min) {
      isViolation = true;
      message = `${key} (${val}${threshold.unit}) 低于下限 ${threshold.min}${threshold.unit}`;
    }

    if (isViolation) {
      violations.push({
        field: key,
        value: val,
        threshold,
        message,
        timestamp
      });
    }
  }

  return violations;
}
