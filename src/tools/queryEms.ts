import axios from 'axios';
import type { HomePageData, BmsYxItem, PcsYcItem, PcsYxItem, DcdcYcItem, DcdcYxItem, MeterYcItem, MeterYxItem, AlarmItem } from '../types/index.js';
import { logger } from '../utils/logger.js';

const EMS_BASE_URL = process.env['EMS_BASE_URL'] ?? 'http://localhost:8080';

/**
 * 获取 EMS 首页综合数据
 * GET /grid-ems/dashboard/getHomePage
 * 包含：光伏发电量、储能充放电量、电网/负载/PCS/BMS 实时参数、系统状态、告警计数
 */
export async function getHomePage(): Promise<HomePageData> {
  const t0 = Date.now();
  logger.info('QueryEms', '查询首页综合数据', { url: `${EMS_BASE_URL}/grid-ems/dashboard/getHomePage` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: HomePageData }>(
      `${EMS_BASE_URL}/grid-ems/dashboard/getHomePage`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    logger.info('QueryEms', '首页综合数据查询成功', {
      systemStatus: response.data.data.systemStatus,
      systemMode: response.data.data.systemMode,
      batterySOC: response.data.data.batterySOC,
      durationMs: Date.now() - t0,
    });

    return response.data.data;
  } catch (err: unknown) {
    logger.error('QueryEms', '首页综合数据查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取 BMS 遥信状态列表
 * GET /grid-ems/bms/yx
 * 包含所有 BMS 告警状态点（过压/欠压/过温/继电器故障等），value=true 表示告警触发
 */
export async function getBmsYx(): Promise<BmsYxItem[]> {
  const t0 = Date.now();
  logger.info('QueryEms', '查询 BMS 遥信状态', { url: `${EMS_BASE_URL}/grid-ems/bms/yx` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: BmsYxItem[] }>(
      `${EMS_BASE_URL}/grid-ems/bms/yx`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const activeAlarms = items.filter(item => item.value === true);

    logger.info('QueryEms', 'BMS 遥信状态查询成功', {
      totalItems: items.length,
      activeAlarms: activeAlarms.length,
      activeKeys: activeAlarms.map(a => a.key),
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', 'BMS 遥信状态查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取 PCS 遥测数据列表
 * GET /grid-ems/pcs/yc
 * 包含：三相电压/电流/功率、功率因数、输入/输出功率、温度、累计充放电量、DCDC 数据等
 */
export async function getPcsYc(): Promise<PcsYcItem[]> {
  const t0 = Date.now();
  logger.info('QueryEms', '查询 PCS 遥测数据', { url: `${EMS_BASE_URL}/grid-ems/pcs/yc` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: PcsYcItem[] }>(
      `${EMS_BASE_URL}/grid-ems/pcs/yc`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    // 提取关键指标写入日志，方便快速定位
    const keyMetrics: Record<string, number> = {};
    for (const item of items) {
      if (['pcsOutputActivePowerTotal', 'pcsInputPower', 'pcsInputVoltage', 'pcsOperatingStatus', 'pcsOutletAirTemp'].includes(item.key)) {
        keyMetrics[item.key] = item.value;
      }
    }

    logger.info('QueryEms', 'PCS 遥测数据查询成功', {
      totalItems: items.length,
      ...keyMetrics,
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', 'PCS 遥测数据查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取 PCS 遥信状态列表
 * GET /grid-ems/pcs/yx
 * 包含：运行状态、并网状态、故障状态、告警状态、控制/通讯软件故障字等
 * value=true 且 sort=1 表示异常/故障触发
 */
export async function getPcsYx(): Promise<PcsYxItem[]> {
  const t0 = Date.now();
  logger.info('QueryEms', '查询 PCS 遥信状态', { url: `${EMS_BASE_URL}/grid-ems/pcs/yx` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: PcsYxItem[] }>(
      `${EMS_BASE_URL}/grid-ems/pcs/yx`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const faultItems = items.filter(item => item.value === true && item.sort === 1);
    const alarmItems = items.filter(item => item.value === true && item.sort === 2);

    logger.info('QueryEms', 'PCS 遥信状态查询成功', {
      totalItems: items.length,
      faultCount: faultItems.length,
      faultKeys: faultItems.map(f => f.key),
      alarmCount: alarmItems.length,
      alarmKeys: alarmItems.map(a => a.key),
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', 'PCS 遥信状态查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取 DCDC 遥测数据列表
 * GET /grid-ems/dcdc/yc?index=N  (0=DCDC1, 1=DCDC2)
 * 包含：BAT/BUS 侧电压电流、运行功率、允许功率、模块最高温度、累积充放电量
 */
export async function getDcdcYc(args: { index: number }): Promise<DcdcYcItem[]> {
  const t0 = Date.now();
  const label = `DCDC${args.index + 1}`;
  logger.info('QueryEms', `查询 ${label} 遥测数据`, { url: `${EMS_BASE_URL}/grid-ems/dcdc/yc`, index: args.index });

  try {
    const response = await axios.get<{ code: number; msg: string; data: DcdcYcItem[] }>(
      `${EMS_BASE_URL}/grid-ems/dcdc/yc`,
      { params: { index: args.index } },
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const keyMetrics: Record<string, number> = {};
    for (const item of items) {
      if (['currentOperatingPower', 'allowedOperatingPower', 'batterySideVoltage', 'busSideVoltage', 'moduleTemperatureMax'].includes(item.key)) {
        keyMetrics[item.key] = item.value;
      }
    }

    logger.info('QueryEms', `${label} 遥测数据查询成功`, {
      totalItems: items.length,
      ...keyMetrics,
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', `${label} 遥测数据查询失败`, {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取 DCDC 遥信状态列表
 * GET /grid-ems/dcdc/yx?index=N  (0=DCDC1, 1=DCDC2)
 * 包含：通讯诊断、故障代码等状态点
 */
export async function getDcdcYx(args: { index: number }): Promise<DcdcYxItem[]> {
  const t0 = Date.now();
  const label = `DCDC${args.index + 1}`;
  logger.info('QueryEms', `查询 ${label} 遥信状态`, { url: `${EMS_BASE_URL}/grid-ems/dcdc/yx`, index: args.index });

  try {
    const response = await axios.get<{ code: number; msg: string; data: DcdcYxItem[] }>(
      `${EMS_BASE_URL}/grid-ems/dcdc/yx`,
      { params: { index: args.index } },
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const faultItems = items.filter(item => item.value === true && item.sort === 1);
    const abnormalItems = items.filter(item => typeof item.value === 'number' && item.value !== 0);

    logger.info('QueryEms', `${label} 遥信状态查询成功`, {
      totalItems: items.length,
      faultCount: faultItems.length,
      faultKeys: faultItems.map(f => f.key),
      abnormalCodes: abnormalItems.map(a => ({ key: a.key, value: a.value })),
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', `${label} 遥信状态查询失败`, {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取电表遥测数据列表
 * GET /grid-ems/meter/yc?index=N  (0=电表1, 1=电表2)
 * 包含：三相电压/电流/有功/无功/视在功率/功率因数/线电压/频率、正反向有功/无功电能
 */
export async function getMeterYc(args: { index: number }): Promise<MeterYcItem[]> {
  const t0 = Date.now();
  const label = `电表${args.index + 1}`;
  logger.info('QueryEms', `查询${label}遥测数据`, { url: `${EMS_BASE_URL}/grid-ems/meter/yc`, index: args.index });

  try {
    const response = await axios.get<{ code: number; msg: string; data: MeterYcItem[] }>(
      `${EMS_BASE_URL}/grid-ems/meter/yc`,
      { params: { index: args.index } },
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const keyMetrics: Record<string, number> = {};
    for (const item of items) {
      if (['totalActivePower', 'totalReactivePower', 'totalPowerFactor', 'forwardActiveEnergy', 'reverseActiveEnergy'].includes(item.key)) {
        keyMetrics[item.key] = item.value;
      }
    }

    logger.info('QueryEms', `${label}遥测数据查询成功`, {
      totalItems: items.length,
      ...keyMetrics,
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', `${label}遥测数据查询失败`, {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取电表遥信状态列表
 * GET /grid-ems/meter/yx?index=N  (0=电表1, 1=电表2)
 * 包含：通讯诊断状态
 */
export async function getMeterYx(args: { index: number }): Promise<MeterYxItem[]> {
  const t0 = Date.now();
  const label = `电表${args.index + 1}`;
  logger.info('QueryEms', `查询${label}遥信状态`, { url: `${EMS_BASE_URL}/grid-ems/meter/yx`, index: args.index });

  try {
    const response = await axios.get<{ code: number; msg: string; data: MeterYxItem[] }>(
      `${EMS_BASE_URL}/grid-ems/meter/yx`,
      { params: { index: args.index } },
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const items = response.data.data;
    const faultItems = items.filter(item => item.value === true && item.sort === 1);
    const commFault = items.filter(item => item.key === 'meterCommDiagnosis' && item.value === true);

    logger.info('QueryEms', `${label}遥信状态查询成功`, {
      totalItems: items.length,
      faultCount: faultItems.length,
      faultKeys: faultItems.map(f => f.key),
      commFault: commFault.length > 0,
      durationMs: Date.now() - t0,
    });

    return items;
  } catch (err: unknown) {
    logger.error('QueryEms', `${label}遥信状态查询失败`, {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 获取实时告警列表
 * GET /grid-ems/AlarmAndEvent/realTimeAlarm/list
 * 返回当前未恢复的所有告警，空列表表示无活跃告警
 */
export async function getRealTimeAlarms(): Promise<AlarmItem[]> {
  const t0 = Date.now();
  logger.info('QueryEms', '查询实时告警', { url: `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/realTimeAlarm/list` });

  try {
    const response = await axios.get<{ code: number; msg: string; data: { list: AlarmItem[] } }>(
      `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/realTimeAlarm/list`,
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const list = response.data.data.list;
    logger.info('QueryEms', '实时告警查询成功', {
      count: list.length,
      alarms: list.map(a => ({ id: a.id, name: a.name, level: a.level, deviceType: a.deviceType, alarmTime: a.alarmTime })),
      durationMs: Date.now() - t0,
    });

    return list;
  } catch (err: unknown) {
    logger.error('QueryEms', '实时告警查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}

/**
 * 查询 PCS 综合数据（遥测 + 遥信合并）
 * 并行调用 GET /grid-ems/pcs/yc 和 GET /grid-ems/pcs/yx
 * 可通过 fields 过滤返回字段（匹配 item.key）
 */
export async function queryPcs(args: { fields?: string[]; deviceId?: string }): Promise<{
  yc: PcsYcItem[];
  yx: PcsYxItem[];
}> {
  const t0 = Date.now();
  logger.info('QueryEms', 'queryPcs 查询 PCS 综合数据（yc + yx）', {
    fields: args.fields,
    deviceId: args.deviceId,
  });

  const [ycItems, yxItems] = await Promise.all([getPcsYc(), getPcsYx()]);

  // 按 fields 过滤（未传则返回全部）
  const yc = args.fields?.length
    ? ycItems.filter(item => args.fields!.includes(item.key))
    : ycItems;
  const yx = args.fields?.length
    ? yxItems.filter(item => args.fields!.includes(item.key))
    : yxItems;

  logger.info('QueryEms', 'queryPcs 查询完成', {
    ycCount: yc.length,
    yxCount: yx.length,
    durationMs: Date.now() - t0,
  });

  return { yc, yx };
}

/**
 * 获取历史告警列表
 * GET /grid-ems/AlarmAndEvent/historyAlarm/list?startTime=...&endTime=...
 * 时间格式：YYYY-MM-DD HH:mm:ss，不传则默认查最近 24 小时
 */
export async function getHistoryAlarms(args: { startTime?: string; endTime?: string }): Promise<AlarmItem[]> {
  const t0 = Date.now();

  // 默认查最近 24 小时
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
  const endTime   = args.endTime   ?? fmt(now);
  const startTime = args.startTime ?? fmt(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  logger.info('QueryEms', '查询历史告警', {
    url: `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/historyAlarm/list`,
    startTime,
    endTime,
  });

  try {
    const response = await axios.get<{ code: number; msg: string; data: { list: AlarmItem[] } }>(
      `${EMS_BASE_URL}/grid-ems/AlarmAndEvent/historyAlarm/list`,
      { params: { startTime, endTime } },
    );

    if (response.data.code !== 200) {
      throw new Error(`接口返回非 200：${response.data.code} ${response.data.msg}`);
    }

    const list = response.data.data.list;
    logger.info('QueryEms', '历史告警查询成功', {
      count: list.length,
      startTime,
      endTime,
      alarms: list.map(a => ({ id: a.id, name: a.name, level: a.level, deviceType: a.deviceType, alarmTime: a.alarmTime, recoverTime: a.recoverTime })),
      durationMs: Date.now() - t0,
    });

    return list;
  } catch (err: unknown) {
    logger.error('QueryEms', '历史告警查询失败', {
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    throw err;
  }
}
