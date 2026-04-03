import cron from 'node-cron';
import { fetchAlarms } from '../tools/queryBms.js';
import { AlarmQueue } from './alarmQueue.js';
import { statusStore } from '../server/statusStore.js';
import { logger } from '../utils/logger.js';

/**
 * 心跳轮询
 * 定时拉取 Java 告警接口，推入队列
 */
// 退避档位（连续失败次数 → 跳过轮询次数）
// 连续失败 3 次后每 2 次才执行 1 次，6 次后每 4 次，10 次后每 10 次（约 5 分钟）
const BACKOFF_SKIP: Array<{ threshold: number; skip: number }> = [
  { threshold: 10, skip: 9 },
  { threshold: 6,  skip: 3 },
  { threshold: 3,  skip: 1 },
];

export class Heartbeat {
  private queue: AlarmQueue;
  private intervalSeconds: number;
  private task: cron.ScheduledTask | null = null;
  private consecutiveFailures = 0;  // 连续失败计数
  private skipCounter = 0;          // 当前退避跳过计数

  constructor(queue: AlarmQueue, intervalSeconds = 30) {
    this.queue = queue;
    this.intervalSeconds = intervalSeconds;
  }

  /** 根据连续失败次数计算需要跳过的轮询次数 */
  private getSkipCount(): number {
    for (const { threshold, skip } of BACKOFF_SKIP) {
      if (this.consecutiveFailures >= threshold) return skip;
    }
    return 0;
  }

  start() {
    const envInterval = process.env['HEARTBEAT_INTERVAL_SECONDS'];
    if (envInterval) this.intervalSeconds = parseInt(envInterval, 10);

    const schedule = `*/${this.intervalSeconds} * * * * *`;

    this.task = cron.schedule(schedule, async () => {
      // 退避：跳过本次轮询
      if (this.skipCounter > 0) {
        this.skipCounter--;
        return;
      }

      const t0 = Date.now();
      logger.info('Heartbeat', '开始轮询告警接口');

      try {
        const alarms = await fetchAlarms();
        const count = Array.isArray(alarms) ? alarms.length : 0;

        for (const alarm of (alarms ?? [])) {
          this.queue.push(alarm);
        }

        this.consecutiveFailures = 0; // 成功后重置失败计数

        logger.info('Heartbeat', '轮询完成', {
          alarmCount: count,
          durationMs: Date.now() - t0,
        });
        statusStore.recordHeartbeat(count, true);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        this.consecutiveFailures++;

        const skip = this.getSkipCount();
        this.skipCounter = skip;

        // 连续失败 3 次前用 error，之后降级为 warn 减少噪音
        const logFn = this.consecutiveFailures >= 3 ? 'warn' : 'error';
        logger[logFn]('Heartbeat', '轮询失败', {
          error: msg,
          consecutiveFailures: this.consecutiveFailures,
          nextSkip: skip,
          durationMs: Date.now() - t0,
        });
        statusStore.recordHeartbeat(0, false, msg);
      }
    });

    logger.info('Heartbeat', 'Heartbeat 启动', { intervalSeconds: this.intervalSeconds });
  }

  stop() {
    if (this.task) {
      this.task.stop();
      logger.info('Heartbeat', 'Heartbeat 已停止');
    }
  }
}
