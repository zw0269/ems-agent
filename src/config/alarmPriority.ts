import type { AlarmPriority } from '../types/index.js';

/**
 * 所有告警类型的优先级定义 (ALARM_PRIORITY)
 *
 * 语义（严重度从高到低）：
 * P3: 紧急 / 一级，可能导致系统损坏或安全事故，需立即处理
 * P2: 重要 / 二级，影响系统运行，需尽快介入
 * P1: 一般 / 三级，需关注，计划内处理
 * P0: 提示 / 四级，仅记录日志
 *
 * 对应上游 EMS 接口的 level 字段：level="3" → P3 ... level="0" → P0
 */
export const ALARM_PRIORITY: Record<string, AlarmPriority> = {
  'battery_smoke': 'P3',
  'fire_alarm': 'P3',
  'emergency_stop': 'P3',
  'cell_voltage_high': 'P2',
  'cell_temp_high': 'P2',
  'insulation_error': 'P2',
  'pcs_communication_lost': 'P2',
  'pcs_grid_error': 'P2',
  'soc_low': 'P1',
  'fan_error': 'P1',
  'comm_error': 'P1',
};

/**
 * 队列排序权重：数值越小越先处理（P3 最严重 → 权重 0）
 */
export const PRIORITY_ORDER: Record<AlarmPriority, number> = {
  'P3': 0,
  'P2': 1,
  'P1': 2,
  'P0': 3,
};
