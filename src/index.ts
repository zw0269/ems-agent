import 'dotenv/config';
import { Heartbeat } from './gateway/heartbeat.js';
import { AlarmQueue } from './gateway/alarmQueue.js';
import { SessionManager } from './gateway/sessionManager.js';
import { AgentLoop } from './runtime/agentLoop.js';
import { checkThresholds } from './config/thresholds.js';
import { ALARM_PRIORITY } from './config/alarmPriority.js';
import { getHomePage, getBmsYx, getPcsYc, getPcsYx, getHistoryAlarms } from './tools/queryEms.js';
import { notifyOperator } from './notifier/index.js';
import { checkLLMConnectivity } from './utils/healthCheck.js';
import { startStatusServer } from './server/statusServer.js';
import { statusStore } from './server/statusStore.js';
import { logger } from './utils/logger.js';
import { getDb } from './db/database.js';
import { insertAlarm, updateAlarmFinished } from './db/alarmRepository.js';
import { insertRealtimeSnapshot } from './db/realtimeSnapshotRepository.js';
import type { Alarm } from './types/index.js';

/**
 * 采集系统当前实时快照
 * 并行调用首页、BMS 遥信、PCS 遥测、PCS 遥信，合并为扁平对象供阈值检查和 LLM 分析
 */
async function gatherSnapshot(alarm: Alarm) {
  const [homePage, bmsYx, pcsYc, pcsYx] = await Promise.all([
    getHomePage(),
    getBmsYx(),
    getPcsYc(),
    getPcsYx(),
  ]);

  // 将 PCS 遥测列表转为 key→value 扁平对象
  const pcsYcMap: Record<string, number> = {};
  for (const item of pcsYc) {
    pcsYcMap[item.key] = item.value;
  }

  // 活跃告警 / 故障点汇总（仅 value===true 的条目）
  const bmsActiveAlarms = bmsYx.filter(i => i.value === true).map(i => i.keyStr);
  const pcsActiveFaults = pcsYx.filter(i => i.value === true && i.sort === 1).map(i => i.keyStr);
  const pcsActiveAlarms = pcsYx.filter(i => i.value === true && i.sort === 2).map(i => i.keyStr);

  const realtime: Record<string, unknown> = {
    // HomePageData 全部字段（包含 batterySOC、batteryVoltage、gridFrequency 等）
    ...homePage,
    // PCS 遥测扁平字段（包含 gridFrequency、pcsInsulationresistance、pcsLeakageCurrent、温度等）
    ...pcsYcMap,
    // 结构化告警摘要
    bmsActiveAlarms,
    pcsActiveFaults,
    pcsActiveAlarms,
    // 元数据
    timestamp:  new Date().toISOString(),
    deviceId:   alarm.deviceId,
  };

  return realtime;
}

/**
 * 采集历史告警记录（最近 24 小时）
 */
async function gatherHistory(alarm: Alarm) {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);
  const endTime   = fmt(now);
  const startTime = fmt(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return getHistoryAlarms({ startTime, endTime });
}

/**
 * 告警处理核心逻辑
 */
async function processAlarm(alarm: Alarm) {
  const t0 = Date.now();
  logger.info('Agent', '告警处理开始', {
    alarmId: alarm.alarmId,
    alarmType: alarm.alarmType,
    faultCategory: alarm.faultCategory,
    priority: alarm.priority,
    deviceId: alarm.deviceId,
  });
  statusStore.startAlarm(alarm);
  insertAlarm(alarm, alarm.alarmId.startsWith('TEST-'));

  try {
    // 并行采集实时快照 + 历史告警
    const [realtime, history] = await Promise.all([
      gatherSnapshot(alarm),
      gatherHistory(alarm),
    ]);

    const violations = checkThresholds(realtime);
    insertRealtimeSnapshot(alarm.alarmId, realtime);

    logger.info('Agent', '数据采集完成，开始 AI 分析', {
      alarmId: alarm.alarmId,
      realtimeKeys: Object.keys(realtime).length,
      historyCount: history.length,
      violationCount: violations.length,
      violations: violations.map(v => v.message),
    });

    const agentLoop = new AgentLoop();
    let conclusion: string;

    if (alarm.faultCategory === 'hardware') {
      conclusion = await agentLoop.runOnce(alarm, realtime, history, violations);
    } else if (alarm.faultCategory === 'software') {
      conclusion = await agentLoop.run(alarm, { realtime, history, violations });
    } else {
      conclusion = `[Agent] 故障类型未知 (faultCategory=${alarm.faultCategory})，请人工判断。`;
      logger.warn('Agent', '未知故障类型', { alarmId: alarm.alarmId, faultCategory: alarm.faultCategory });
    }

    await notifyOperator(alarm, conclusion);

    const durationMs = Date.now() - t0;
    logger.info('Agent', '告警处理完成', {
      alarmId: alarm.alarmId,
      durationMs,
      conclusionLength: conclusion.length,
    });
    statusStore.finishAlarm(alarm.alarmId, conclusion, false);
    updateAlarmFinished(alarm.alarmId, conclusion, false, durationMs);
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const errorMsg = `分析异常: ${(err as Error).message}，请人工介入。`;
    logger.error('Agent', '告警处理发生错误', {
      alarmId: alarm.alarmId,
      error: (err as Error).message,
      durationMs,
    });
    await notifyOperator(alarm, errorMsg);
    statusStore.finishAlarm(alarm.alarmId, errorMsg, true);
    updateAlarmFinished(alarm.alarmId, errorMsg, true, durationMs);
  }
}

/**
 * 主入口
 */
async function main() {
  logger.info('Agent', '═══════════════════════════════════');
  logger.info('Agent', '  EMS Agent (Node.js) 启动');
  logger.info('Agent', '═══════════════════════════════════');

  // 1. 初始化数据库（确保表结构就绪）
  getDb();

  const statusPort = parseInt(process.env['STATUS_PORT'] ?? '3000', 10);
  const apiOk = await checkLLMConnectivity();
  statusStore.setLLMApiStatus(apiOk);
  if (!apiOk) {
    logger.warn('Agent', 'LLM API 连通测试失败，Agent 仍将运行，告警处理可能失败');
  }

  // 2. 初始化 Gateway
  const sessionManager = new SessionManager();
  const alarmQueue = new AlarmQueue(sessionManager);
  const heartbeatInterval = parseInt(process.env['HEARTBEAT_INTERVAL_SECONDS'] ?? '30', 10);
  const heartbeat = new Heartbeat(alarmQueue, heartbeatInterval);
  heartbeat.start();

  // 3. 启动状态面板（alarmQueue 就绪后传入，支持手动注入）
  startStatusServer(statusPort, alarmQueue);
  logger.info('Agent', '状态面板已启动', { port: statusPort });

  // 4. 主消费循环
  setInterval(async () => {
    statusStore.updateQueueLength(alarmQueue.length);

    const alarm = alarmQueue.pop();
    if (!alarm) return;

    if (!alarm.priority) alarm.priority = ALARM_PRIORITY[alarm.alarmType] ?? 'P2';

    sessionManager.start(alarm.alarmId);
    statusStore.updateSessionCount(1);

    try {
      await processAlarm(alarm);
    } catch (err: unknown) {
      logger.error('Agent', '主循环捕获异常', {
        alarmId: alarm.alarmId,
        error: (err as Error).message,
      });
    } finally {
      sessionManager.finish(alarm.alarmId);
      statusStore.updateSessionCount(0);
    }
  }, 1000);

  logger.info('Agent', '主消费循环已启动，等待告警入队');
}

process.on('uncaughtException', (err) => {
  logger.error('Agent', '未捕获的异常', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Agent', '未处理的 Promise 拒绝', { reason: String(reason) });
});

main().catch(err => {
  logger.error('Agent', '程序启动失败', { error: (err as Error).message });
  process.exit(1);
});
