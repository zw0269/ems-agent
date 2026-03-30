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
import type { Alarm } from './types/index.js';

/**
 * 告警处理核心逻辑
 * 组装所有模块：Heartbeat → Queue → processAlarm
 */
async function processAlarm(alarm: Alarm) {
  const startTime = Date.now();
  console.log(`[Agent] >>> 开始处理告警: ${alarm.alarmId} / ${alarm.alarmType}`);

  try {
    // 1. 字段筛选
    const fields = getFields(alarm.alarmType);

    // 2. 数据查询（并行执行提高效率）
    console.log(`[Agent] 正在并行查询实时数据和历史数据...`);
    const [realtime, history] = await Promise.all([
      queryBms({ fields, deviceId: alarm.deviceId }),
      queryHistory({ fields, hours: 24, deviceId: alarm.deviceId }),
    ]);

    // 3. 确定性阈值检测（不走 LLM）
    const violations = checkThresholds(realtime);

    // 4. 分支处理
    const agentLoop = new AgentLoop();
    let conclusion: string;

    if (alarm.faultCategory === 'hardware') {
      // 硬件故障：单次 LLM 调用
      conclusion = await agentLoop.runOnce(alarm, realtime, history, violations);
    } else if (alarm.faultCategory === 'software') {
      // 软件故障：完整 Agent Loop
      conclusion = await agentLoop.run(alarm, { realtime, history, violations });
    } else {
      conclusion = `[Agent] 故障类型未知 (faultCategory=${alarm.faultCategory})，请人工判断。`;
    }

    // 5. 通知运营人员
    await notifyOperator(alarm, conclusion);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Agent] <<< 告警处理完成: ${alarm.alarmId}, 耗时: ${duration}s`);
  } catch (err) {
    console.error(`[Agent] !!! 告警处理过程中发生严重错误: ${alarm.alarmId}`, err);
    // 记录错误结论并通知
    const errorConclusion = `[Agent] 分析过程中发生异常: ${(err as Error).message}\n请立即人工介入。`;
    await notifyOperator(alarm, errorConclusion);
  }
}

/**
 * 主入口函数
 */
async function main() {
  console.log('========================================');
  console.log('   EMS Agent (Node.js) 启动中...');
  console.log('========================================');

  const sessionManager = new SessionManager();
  const alarmQueue = new AlarmQueue(sessionManager);
  
  // 初始化心跳轮询
  const heartbeatInterval = parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '30', 10);
  const heartbeat = new Heartbeat(alarmQueue, heartbeatInterval);
  heartbeat.start();

  // 主消费循环：每秒检查一次队列
  setInterval(async () => {
    const alarm = alarmQueue.pop();
    if (!alarm) return;

    // 补全优先级（如果接口未返回）
    if (!alarm.priority) {
      alarm.priority = ALARM_PRIORITY[alarm.alarmType] ?? 'P2';
    }

    // 开启会话锁定
    sessionManager.start(alarm.alarmId);

    try {
      await processAlarm(alarm);
    } catch (err) {
      console.error(`[Main] 处理队列任务失败: ${alarm.alarmId}`, err);
    } finally {
      // 无论成功失败，结束会话（由 SessionManager 内部逻辑处理 done 状态及清理）
      sessionManager.finish(alarm.alarmId);
    }
  }, 1000);

  console.log('[Main] 主消费循环已启动，等待告警入队...');
}

/**
 * 全局未捕获异常处理
 */
process.on('uncaughtException', (err) => {
  console.error('[Fatal] 未捕获的异常:', err);
  // 在生产环境中，这里通常会执行进程退出并由 PM2 重启
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] 未处理的 Promise 拒绝:', reason);
});

main().catch(err => {
  console.error('[Fatal] 程序启动失败:', err);
  process.exit(1);
});
