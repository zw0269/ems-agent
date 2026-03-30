/**
 * 核心点位定义（CORE_FIELDS）
 * 包含储能系统最关键的 20-25 个点位
 */
export const CORE_FIELDS = [
  'bms_total_voltage',     // 总电压 (V)
  'bms_total_current',     // 总电流 (A)
  'bms_soc',               // SOC (%)
  'bms_soh',               // SOH (%)
  'bms_max_cell_voltage',  // 最高单体电压 (V)
  'bms_min_cell_voltage',  // 最低单体电压 (V)
  'bms_max_temp',          // 最高温度 (℃)
  'bms_min_temp',          // 最低温度 (℃)
  'bms_insulation_res',    // 绝缘电阻 (kΩ)
  'pcs_dc_voltage',        // PCS 直流侧电压 (V)
  'pcs_dc_current',        // PCS 直流侧电流 (A)
  'pcs_ac_active_power',   // 有功功率 (kW)
  'pcs_ac_reactive_power', // 无功功率 (kVar)
  'pcs_ac_voltage_ab',     // AC 电压 AB (V)
  'pcs_ac_voltage_bc',     // AC 电压 BC (V)
  'pcs_ac_voltage_ca',     // AC 电压 CA (V)
  'pcs_grid_freq',         // 电网频率 (Hz)
  'pcs_charge_limit',      // 充电功率限制 (kW)
  'pcs_discharge_limit',   // 放电功率限制 (kW)
  'pcs_status',            // PCS 状态码
  'ems_ambient_temp',      // 环境温度 (℃)
  'ems_humidity',          // 环境湿度 (%)
];

/**
 * 额外字段定义（EXTRA_FIELDS）
 * 根据不同告警类型需要补充查看的字段
 */
export const EXTRA_FIELDS: Record<string, string[]> = {
  'cell_voltage_high': ['bms_cell_voltages', 'pcs_charge_limit'],
  'cell_temp_high': ['bms_cell_temps', 'cooling_system_status'],
  'insulation_error': ['bms_positive_insulation', 'bms_negative_insulation'],
  'pcs_communication_lost': ['ems_comm_status', 'switch_status'],
};

export function getFields(alarmType: string): string[] {
  const extra = EXTRA_FIELDS[alarmType] || [];
  return Array.from(new Set([...CORE_FIELDS, ...extra]));
}
