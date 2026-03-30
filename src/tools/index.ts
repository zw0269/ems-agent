/**
 * LLM 可用工具清单 (TOOLS_DEFINITION)
 * 对应 OpenClaw 的 Skills 描述
 */
export const TOOLS_DEFINITION = [
  {
    name: 'getHomePage',
    description: '获取 EMS 系统首页综合数据，包含：光伏发电量、储能充放电量、电网/负载/PCS/BMS 实时电压电流功率、电池 SOC、系统运行模式、告警计数（严重/中等/轻微）等',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getBmsYx',
    description: '获取 BMS 所有遥信状态点列表，包含单体过压/欠压、过温/欠温、过流、继电器故障、通讯故障、SOC 过低、热失控等告警状态。value=true 表示当前告警触发，可用于判断 BMS 硬件故障根因',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getPcsYc',
    description: '获取 PCS 遥测数据列表，包含三相电压/电流/有功功率/无功功率/视在功率/功率因数、输入直流电压电流功率、散热器温度、三相温度、进/出风口温度、累计充放电量、漏电流、绝缘电阻、DCDC 参数等实时测量值',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getPcsYx',
    description: '获取 PCS 遥信状态点列表，包含运行状态、并网状态、远程/就地状态、总故障/总告警、急停状态、VF 离网、过载降容、BMS 干接点状态、控制软件故障字（1-5）、通讯软件故障字（1-2）。sort=1 且 value=true 表示故障触发，可用于判断 PCS 运行异常根因',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getDcdcYc',
    description: '获取指定 DCDC 变换器的遥测数据，包含 BAT/BUS 侧电压电流、当前运行功率、允许运行功率、模块最高温度、累积充放电量。index=0 表示 DCDC1，index=1 表示 DCDC2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'DCDC 编号，0=DCDC1，1=DCDC2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getDcdcYx',
    description: '获取指定 DCDC 变换器的遥信状态，包含通讯诊断状态和故障代码。index=0 表示 DCDC1，index=1 表示 DCDC2。故障代码非 0 表示存在异常',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'DCDC 编号，0=DCDC1，1=DCDC2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getMeterYc',
    description: '获取指定电表的遥测数据，包含三相电压/电流/有功功率/无功功率/视在功率/功率因数/线电压/频率，以及正反向有功/无功累计电能。index=0 表示电表1，index=1 表示电表2',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '电表编号，0=电表1，1=电表2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getMeterYx',
    description: '获取指定电表的遥信状态，包含通讯诊断状态。index=0 表示电表1，index=1 表示电表2。通讯诊断 value=true 表示通讯异常',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: '电表编号，0=电表1，1=电表2' },
      },
      required: ['index'],
    },
  },
  {
    name: 'getRealTimeAlarms',
    description: '获取当前系统实时告警列表，返回所有尚未恢复的活跃告警（含告警名称、等级、设备类型、告警时间）。空列表表示当前无活跃告警',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'getHistoryAlarms',
    description: '查询指定时间段内的历史告警记录，包含告警名称、等级、设备类型、告警时间、恢复时间。不传时间则默认查最近 24 小时。时间格式：YYYY-MM-DD HH:mm:ss',
    parameters: {
      type: 'object',
      properties: {
        startTime: { type: 'string', description: '查询开始时间，格式 YYYY-MM-DD HH:mm:ss，默认 24 小时前' },
        endTime:   { type: 'string', description: '查询结束时间，格式 YYYY-MM-DD HH:mm:ss，默认当前时间' },
      },
      required: [],
    },
  },
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
