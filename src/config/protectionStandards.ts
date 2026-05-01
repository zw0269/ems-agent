/**
 * 保护定值标准库（GB/T 19964 并网标准）
 * 用于判断保护定值是否合理，避免误判"阈值配置不匹配"
 */

/**
 * 交流电压保护标准（220V系统）
 */
export const AC_VOLTAGE_STANDARDS = {
  /** 额定电压 */
  rated: 220,
  /** 正常范围（±7%） */
  normalRange: { min: 204.6, max: 235.4 },
  /** 预警上限（不触发保护，但需关注） */
  warningHigh: 242,
  /** 预警下限 */
  warningLow: 198,
  /** 过压保护触发范围 */
  overVoltageProtection: { min: 260, max: 270 },
  /** 欠压保护触发范围 */
  underVoltageProtection: { min: 185, max: 190 },
  /** 单位 */
  unit: 'V',
  /** 备注 */
  note: '242V为预警上限，260V以上才是真过压；低于185V触发欠压保护',
} as const;

/**
 * 频率保护标准（GB/T 19964）
 */
export const FREQUENCY_STANDARDS = {
  /** 额定频率 */
  rated: 50,
  /** 正常运行范围 */
  normalRange: { min: 49.5, max: 50.5 },
  /** 频率上限保护触发范围 */
  overFrequencyProtection: { min: 50.2, max: 50.5 },
  /** 频率下限保护触发范围 */
  underFrequencyProtection: { min: 49.5, max: 49.8 },
  /** 建议回差（死区） */
  deadBand: 0.1,
  /** 单位 */
  unit: 'Hz',
  /** 备注 */
  note: 'GB/T 19964标准，回差建议≥0.1Hz避免振荡',
} as const;

/**
 * 直流电压保护标准（1000V系统）
 */
export const DC_VOLTAGE_STANDARDS = {
  /** 额定电压 */
  rated: 1000,
  /** 正常运行范围 */
  normalRange: { min: 700, max: 1000 },
  /** 过压保护触发范围 */
  overVoltageProtection: { min: 950, max: 1000 },
  /** 欠压保护触发范围 */
  underVoltageProtection: { min: 650, max: 700 },
  /** 单位 */
  unit: 'V',
  /** 备注 */
  note: '根据BMS额定电压调整，低于650V可能无法正常运行',
} as const;

/**
 * 电压不平衡度标准
 */
export const VOLTAGE_IMBALANCE_STANDARDS = {
  /** 预警阈值 */
  warningThreshold: 1,
  /** 保护触发阈值 */
  protectionThreshold: 2,
  /** 单位 */
  unit: '%',
  /** 备注 */
  note: '负序分量百分比，>2%才定性为故障',
} as const;

/**
 * 判断电压是否在正常范围内
 */
export function isVoltageNormal(voltage: number, type: 'AC' | 'DC'): boolean {
  const standard = type === 'AC' ? AC_VOLTAGE_STANDARDS : DC_VOLTAGE_STANDARDS;
  return voltage >= standard.normalRange.min && voltage <= standard.normalRange.max;
}

/**
 * 判断电压是否触发过压保护
 */
export function isOverVoltageProtection(voltage: number, type: 'AC' | 'DC'): boolean {
  const standard = type === 'AC' ? AC_VOLTAGE_STANDARDS : DC_VOLTAGE_STANDARDS;
  return voltage >= standard.overVoltageProtection.min;
}

/**
 * 判断电压是否触发欠压保护
 */
export function isUnderVoltageProtection(voltage: number, type: 'AC' | 'DC'): boolean {
  const standard = type === 'AC' ? AC_VOLTAGE_STANDARDS : DC_VOLTAGE_STANDARDS;
  return voltage <= standard.underVoltageProtection.max;
}

/**
 * 判断电压是否在预警范围（需关注但不触发保护）
 */
export function isVoltageWarning(voltage: number, type: 'AC' | 'DC'): 'high' | 'low' | null {
  if (type === 'AC') {
    if (voltage >= AC_VOLTAGE_STANDARDS.warningHigh && voltage < AC_VOLTAGE_STANDARDS.overVoltageProtection.min) {
      return 'high';
    }
    if (voltage <= AC_VOLTAGE_STANDARDS.warningLow && voltage > AC_VOLTAGE_STANDARDS.underVoltageProtection.max) {
      return 'low';
    }
  }
  return null;
}

/**
 * 判断频率是否在正常范围内
 */
export function isFrequencyNormal(frequency: number): boolean {
  return frequency >= FREQUENCY_STANDARDS.normalRange.min && frequency <= FREQUENCY_STANDARDS.normalRange.max;
}

/**
 * 判断频率是否触发保护
 */
export function isFrequencyProtection(frequency: number): 'over' | 'under' | null {
  if (frequency >= FREQUENCY_STANDARDS.overFrequencyProtection.min) {
    return 'over';
  }
  if (frequency <= FREQUENCY_STANDARDS.underFrequencyProtection.max) {
    return 'under';
  }
  return null;
}

/**
 * 判断电压不平衡度是否超标
 */
export function isVoltageImbalance(imbalancePercent: number): 'warning' | 'protection' | null {
  if (imbalancePercent >= VOLTAGE_IMBALANCE_STANDARDS.protectionThreshold) {
    return 'protection';
  }
  if (imbalancePercent >= VOLTAGE_IMBALANCE_STANDARDS.warningThreshold) {
    return 'warning';
  }
  return null;
}

/**
 * 计算三相电压不平衡度（负序分量百分比）
 * 简化算法：(最大相电压 - 最小相电压) / 平均相电压 * 100
 */
export function calculateVoltageImbalance(voltageA: number, voltageB: number, voltageC: number): number {
  const max = Math.max(voltageA, voltageB, voltageC);
  const min = Math.min(voltageA, voltageB, voltageC);
  const avg = (voltageA + voltageB + voltageC) / 3;
  return ((max - min) / avg) * 100;
}

/**
 * 合规性检查：判断保护定值调整是否违反标准
 */
export function checkProtectionCompliance(
  type: 'voltage' | 'frequency',
  proposedValue: number,
): { compliant: boolean; reason?: string } {
  if (type === 'voltage') {
    // 检查是否在标准范围内
    if (proposedValue < AC_VOLTAGE_STANDARDS.underVoltageProtection.min ||
        proposedValue > AC_VOLTAGE_STANDARDS.overVoltageProtection.max) {
      return {
        compliant: false,
        reason: `建议值${proposedValue}V超出GB/T 19964标准范围（${AC_VOLTAGE_STANDARDS.underVoltageProtection.min}-${AC_VOLTAGE_STANDARDS.overVoltageProtection.max}V），需电网公司审批`,
      };
    }
  } else if (type === 'frequency') {
    // 检查是否在标准范围内
    if (proposedValue < FREQUENCY_STANDARDS.underFrequencyProtection.min ||
        proposedValue > FREQUENCY_STANDARDS.overFrequencyProtection.max) {
      return {
        compliant: false,
        reason: `建议值${proposedValue}Hz超出GB/T 19964标准范围（${FREQUENCY_STANDARDS.underFrequencyProtection.min}-${FREQUENCY_STANDARDS.overFrequencyProtection.max}Hz），需电网公司审批`,
      };
    }
  }
  return { compliant: true };
}
