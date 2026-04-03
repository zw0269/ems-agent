/**
 * LLM 可用工具清单 (TOOLS_DEFINITION)
 * 精简描述：聚焦"何时调用"，不枚举字段名（字段名见领域知识提示词）
 */
export const TOOLS_DEFINITION = [
  {
    name: 'getHomePage',
    description: '获取系统概览：电池 SOC、PCS/BMS/电网整体运行参数、系统模式、告警计数',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getBmsYx',
    description: '获取 BMS 所有告警/故障遥信状态（value=true 表示触发），用于定位 BMS 硬件故障根因',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getPcsYc',
    description: '获取 PCS 实时遥测值（电压/电流/功率/温度/充放电量），用于分析 PCS 运行参数异常',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getPcsYx',
    description: '获取 PCS 运行/故障/告警遥信状态（sort=1 且 value=true 为故障），用于判断 PCS 异常根因',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'queryPcs',
    description: '获取 PCS 综合数据（遥测+遥信合并），可按 fields 过滤关注字段，需要同时查 PCS 测量值和状态时使用',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '按 key 过滤返回字段，不传则返回全部',
        },
      },
      required: [],
    },
  },
  {
    name: 'getDcdcYc',
    description: '获取指定 DCDC 变换器实时遥测（功率/电压/温度），index=0 为 DCDC1，index=1 为 DCDC2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '0=DCDC1，1=DCDC2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getDcdcYx',
    description: '获取指定 DCDC 故障代码和通讯诊断状态，故障代码非 0 表示异常，index=0 为 DCDC1，1 为 DCDC2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '0=DCDC1，1=DCDC2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getMeterYc',
    description: '获取指定电表实时遥测（三相电压/电流/功率/电能），index=0 为电表1，index=1 为电表2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '0=电表1，1=电表2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getMeterYx',
    description: '获取指定电表通讯状态，通讯异常时 value=true，index=0 为电表1，1 为电表2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '0=电表1，1=电表2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getRealTimeAlarms',
    description: '获取当前所有活跃告警列表（未恢复），空列表表示无告警，用于确认当前系统告警全貌',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getHistoryAlarms',
    description: '查询历史告警记录（含恢复时间），默认最近 24 小时，用于分析告警趋势和历史规律',
    parameters: {
      type: 'object',
      properties: {
        startTime: { type: 'string', description: '开始时间，格式 YYYY-MM-DD HH:mm:ss，默认 24 小时前' },
        endTime:   { type: 'string', description: '结束时间，格式 YYYY-MM-DD HH:mm:ss，默认当前' },
      },
      required: [],
    },
  },
];
