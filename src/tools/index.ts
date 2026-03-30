/**
 * LLM 可用工具清单 (TOOLS_DEFINITION)
 * 对应 OpenClaw 的 Skills 描述
 */
export const TOOLS_DEFINITION = [
  {
    name: 'queryBms',
    description: '查询 BMS 实时遥测数据，包括电压、电流、SOC、单体数据等',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '需要查询的点位 key 列表，如 bms_total_voltage, bms_soc',
        },
        deviceId: { type: 'string', description: '设备 ID，不传则查全部' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'queryPcs',
    description: '查询 PCS 实时遥测数据，包括直流电压、交流电压、功率、充电上限等',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '需要查询的点位 key 列表，如 pcs_dc_voltage, pcs_charge_limit',
        },
        deviceId: { type: 'string' },
      },
      required: ['fields'],
    },
  },
  {
    name: 'queryHistory',
    description: '查询指定点位的历史数据，用于分析趋势和判断问题是否为渐进性',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '需要查询的点位 key 列表',
        },
        hours: { type: 'number', description: '查询过去 N 小时的数据' },
        deviceId: { type: 'string' },
      },
      required: ['fields', 'hours'],
    },
  },
];
