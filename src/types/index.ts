export type AlarmPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FaultCategory = 'hardware' | 'software';

export interface Alarm {
  alarmId: string;
  alarmType: string;
  faultCategory: FaultCategory;
  deviceId: string;
  timestamp: string;
  priority: AlarmPriority;
}

export interface TelemetryData {
  [key: string]: any;
  timestamp: string;
  deviceId: string;
}

/**
 * EMS 首页综合数据（/grid-ems/dashboard/getHomePage）
 */
export interface HomePageData {
  cumulativeGeneration: number;
  dailyGeneration: number;
  selfConsumptionRate: number;
  pvGenerationHours: number;
  dailyChargingAmount: number;
  cumulativeChargingAmount: number;
  dailyDischargingAmount: number;
  cumulativeDischargingAmount: number;
  conversionEfficiency: number;
  gridVoltage: number;
  gridCurrent: number;
  gridPower: number;
  loadVoltage: number;
  loadCurrent: number;
  loadPower: number;
  pvVoltage: number;
  pvCurrent: number;
  pvPower: number;
  chargerVoltage: number;
  chargerCurrent: number;
  chargerPower: number;
  pcsStatus: number;
  pcsVoltage: number;
  pcsCurrent: number;
  pcsPower: number;
  batteryStatus: number;
  batteryPower: number;
  batteryVoltage: number;
  batteryCurrent: number;
  batterySOC: number;
  incomeValue: number;
  coalValue: number;
  co2Value: number;
  systemStatus: number;
  systemMode: string;
  seriousAlarm: number;
  mediumAlarm: number;
  minorAlarm: number;
  totalLoadVoltage: number;
  totalLoadCurrent: number;
  totalLoadPower: number;
  antirefluxZone: number;
  demandZone: number;
}

/**
 * BMS 遥信状态点（/grid-ems/bms/yx）
 */
export interface BmsYxItem {
  key: string;
  keyStr: string;
  value: boolean | number;
  valueStr: string;
  sort: number;
}

/**
 * PCS 遥测数据点（/grid-ems/pcs/yc）
 */
export interface PcsYcItem {
  key: string;
  keyStr: string;
  value: number;
  valueStr: string;
}

/**
 * PCS 遥信状态点（/grid-ems/pcs/yx）
 */
export interface PcsYxItem {
  key: string;
  keyStr: string;
  value: boolean | number;
  valueStr: string;
  sort: number;
}

/**
 * DCDC 遥测数据点（/grid-ems/dcdc/yc?index=N）
 */
export interface DcdcYcItem {
  key: string;
  keyStr: string;
  value: number;
  valueStr: string;
}

/**
 * DCDC 遥信状态点（/grid-ems/dcdc/yx?index=N）
 */
export interface DcdcYxItem {
  key: string;
  keyStr: string;
  value: boolean | number;
  valueStr: string;
  sort: number;
}

/**
 * 电表遥测数据点（/grid-ems/meter/yc?index=N）
 */
export interface MeterYcItem {
  key: string;
  keyStr: string;
  value: number;
  valueStr: string;
}

/**
 * 电表遥信状态点（/grid-ems/meter/yx?index=N）
 */
export interface MeterYxItem {
  key: string;
  keyStr: string;
  value: boolean | number;
  valueStr: string;
  sort: number;
}

/**
 * 告警条目（实时告警 / 历史告警共用）
 */
export interface AlarmItem {
  id: number;
  name: string;
  level: string;
  deviceType: string;
  alarmTime: string;
  recoverTime?: string | undefined;
}

export interface Violation {
  field: string;
  value: any;
  threshold: any;
  message: string;
  timestamp: string;
}

export type LLMResponseType = 'final_answer' | 'tool_call';

export interface LLMResponse {
  type: LLMResponseType;
  text?: string | undefined;
  toolName?: string | undefined;
  toolCallId?: string | undefined;
  args?: any;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 内部统一消息格式（OpenAI 风格）
 * exactOptionalPropertyTypes: 可选字段使用 T | undefined 明确允许 undefined 值
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
}
