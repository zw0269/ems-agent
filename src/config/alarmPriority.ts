import type { AlarmPriority } from '../types/index.js';

/**
 * 所有告警类型的优先级定义 (ALARM_PRIORITY)
 * P0: 紧急，可能导致系统损坏
 * P1: 重要，影响系统运行
 * P2: 一般，需关注
 * P3: 提示，记录日志
 */
export const ALARM_PRIORITY: Record<string, AlarmPriority> = {
  'battery_smoke': 'P0',
  'fire_alarm': 'P0',
  'emergency_stop': 'P0',
  'cell_voltage_high': 'P1',
  'cell_temp_high': 'P1',
  'insulation_error': 'P1',
  'pcs_communication_lost': 'P1',
  'pcs_grid_error': 'P1',
  'soc_low': 'P2',
  'fan_error': 'P2',
  'comm_error': 'P2',
};

export const PRIORITY_ORDER: Record<AlarmPriority, number> = {
  'P0': 0,
  'P1': 1,
  'P2': 2,
  'P3': 3,
};
