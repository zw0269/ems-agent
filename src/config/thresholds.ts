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
 * R1 数据一致性前置校验（三项自洽检查）
 * 在阈值检查前执行，优先发现数据采样/配置错误
 */
export function checkDataConsistency(realtime: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  const timestamp = (realtime['timestamp'] as string | undefined) ?? new Date().toISOString();

  // R1.1 状态 vs 功率/电流方向校验
  const operatingStatus = realtime['pcsOperatingStatus'] as number | undefined;
  const current = Math.abs((realtime['batteryCurrent'] as number | undefined) ?? 0);
  const power = Math.abs((realtime['batteryPower'] as number | undefined) ?? 0);

  if ((operatingStatus === 0 || operatingStatus === 4) && (current > 10 || power > 5)) {
    violations.push({
      field: 'pcsOperatingStatus',
      value: operatingStatus,
      threshold: { unit: '' },
      message: `[R1.1 状态矛盾] 设备状态为"${operatingStatus === 0 ? '停机' : '备用'}"但电流${current.toFixed(1)}A或功率${power.toFixed(1)}kW异常，优先判定为信号链/状态采样故障`,
      timestamp,
    });
  }

  // R1.2 母线电压内部一致性校验：UpVol + DownVol ≈ TotalDirectVol
  const upVol = realtime['pcsUpVol'] as number | undefined;
  const downVol = realtime['pcsDownVol'] as number | undefined;
  const totalVol = realtime['pcsTotalDirectVol'] as number | undefined;

  if (upVol !== undefined && downVol !== undefined && totalVol !== undefined) {
    const sum = upVol + downVol;
    const deviation = Math.abs(sum - totalVol);
    const deviationPercent = (deviation / totalVol) * 100;

    if (deviationPercent > 5) {
      violations.push({
        field: 'pcsTotalDirectVol',
        value: totalVol,
        threshold: { unit: 'V' },
        message: `[R1.2 母线电压不自洽] UpVol(${upVol}V) + DownVol(${downVol}V) = ${sum.toFixed(1)}V，与TotalDirectVol(${totalVol}V)偏差${deviation.toFixed(1)}V(${deviationPercent.toFixed(1)}%)，优先判定为采样系数配置/寄存器映射/通讯解析错误`,
        timestamp,
      });
    }
  }

  // R1.3 PCS采样 vs 电表采样偏差校验
  const pcsVoltage = realtime['pcsInputVoltage'] as number | undefined;
  const meterVoltage = realtime['meterVoltageA'] as number | undefined;

  if (pcsVoltage !== undefined && meterVoltage !== undefined && meterVoltage > 0) {
    const deviation = Math.abs(pcsVoltage - meterVoltage);
    const deviationPercent = (deviation / meterVoltage) * 100;

    if (deviationPercent > 10) {
      violations.push({
        field: 'pcsInputVoltage',
        value: pcsVoltage,
        threshold: { unit: 'V' },
        message: `[R1.3 采样偏差] PCS采样电压(${pcsVoltage}V)与电表采样(${meterVoltage}V)偏差${deviation.toFixed(1)}V(${deviationPercent.toFixed(1)}%)，优先校验CT/PT变比、二次接线、屏蔽接地`,
        timestamp,
      });
    }
  }

  return violations;
}

/**
 * 检查实时快照中的越限项
 * 输入为由真实 API 数据构建的扁平对象
 */
export function checkThresholds(realtime: Record<string, unknown>): Violation[] {
  const violations: Violation[] = [];
  const timestamp = (realtime['timestamp'] as string | undefined) ?? new Date().toISOString();

  // 先执行数据一致性校验（R1）
  violations.push(...checkDataConsistency(realtime));

  // 再执行阈值越限检查
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
