import 'dotenv/config';
import { Heartbeat } from './gateway/heartbeat.js';
import { AlarmQueue } from './gateway/alarmQueue.js';
import { SessionManager } from './gateway/sessionManager.js';
import { AgentLoop } from './runtime/agentLoop.js';
import { getFields } from './config/fieldMap.js';
import { checkThresholds } from './config/thresholds.js';
import { ALARM_PRIORITY } from './config/alarmPriority.js';
import { queryBms } from './tools/queryBms.js';
import { queryHistory } from './tools/queryHistory.js';
import { notifyOperator } from './notifier/index.js';
import { checkLLMConnectivity } from './utils/healthCheck.js';
import { startStatusServer } from './server/statusServer.js';
import { statusStore } from './server/statusStore.js';
import { logger } from './utils/logger.js';
import type { Alarm } from './types/index.js';

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

  try {
    const fields = getFields(alarm.alarmType);

    const [realtime, history] = await Promise.all([
      queryBms({ fields, deviceId: alarm.deviceId }),
      queryHistory({ fields, hours: 24, deviceId: alarm.deviceId }),
    ]);

    const violations = checkThresholds(realtime);
    logger.info('Agent', '数据采集完成，开始 AI 分析', {
      alarmId: alarm.alarmId,
      fieldsCount: fields.length,
      violationCount: violations.length,
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

    logger.info('Agent', '告警处理完成', {
      alarmId: alarm.alarmId,
      durationMs: Date.now() - t0,
      conclusionLength: conclusion.length,
    });
    statusStore.finishAlarm(alarm.alarmId, conclusion, false);
  } catch (err: unknown) {
    const errorMsg = `分析异常: ${(err as Error).message}，请人工介入。`;
    logger.error('Agent', '告警处理发生错误', {
      alarmId: alarm.alarmId,
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    await notifyOperator(alarm, errorMsg);
    statusStore.finishAlarm(alarm.alarmId, errorMsg, true);
  }
}

/**
 * 主入口
 */
async function main() {
  logger.info('Agent', '═══════════════════════════════════');
  logger.info('Agent', '  EMS Agent (Node.js) 启动');
  logger.info('Agent', '═══════════════════════════════════');

  // 1. 启动状态面板
  const statusPort = parseInt(process.env['STATUS_PORT'] ?? '3000', 10);
  startStatusServer(statusPort);
  logger.info('Agent', '状态面板已启动', { port: statusPort });

  // 2. 测试 LLM API 连通性
  const apiOk = await checkLLMConnectivity();
  statusStore.setLLMApiStatus(apiOk);
  if (!apiOk) {
    logger.warn('Agent', 'LLM API 连通测试失败，Agent 仍将运行，告警处理可能失败');
  }

  // 3. 初始化 Gateway
  const sessionManager = new SessionManager();
  const alarmQueue = new AlarmQueue(sessionManager);
  const heartbeatInterval = parseInt(process.env['HEARTBEAT_INTERVAL_SECONDS'] ?? '30', 10);
  const heartbeat = new Heartbeat(alarmQueue, heartbeatInterval);
  heartbeat.start();

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
