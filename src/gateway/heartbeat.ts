import cron from 'node-cron';
import { fetchAlarms } from '../tools/queryBms.js';
import { AlarmQueue } from './alarmQueue.js';
import { statusStore } from '../server/statusStore.js';
import { logger } from '../utils/logger.js';

/**
 * 心跳轮询
 * 定时拉取 Java 告警接口，推入队列
 */
export class Heartbeat {
  private queue: AlarmQueue;
  private intervalSeconds: number;
  private task: cron.ScheduledTask | null = null;

  constructor(queue: AlarmQueue, intervalSeconds = 30) {
    this.queue = queue;
    this.intervalSeconds = intervalSeconds;
  }

  start() {
    const envInterval = process.env['HEARTBEAT_INTERVAL_SECONDS'];
    if (envInterval) this.intervalSeconds = parseInt(envInterval, 10);

    const schedule = `*/${this.intervalSeconds} * * * * *`;

    this.task = cron.schedule(schedule, async () => {
      const t0 = Date.now();
      logger.info('Heartbeat', '开始轮询告警接口');

      try {
        const alarms = await fetchAlarms();
        const count = Array.isArray(alarms) ? alarms.length : 0;

        for (const alarm of (alarms ?? [])) {
          this.queue.push(alarm);
        }

        logger.info('Heartbeat', '轮询完成', {
          alarmCount: count,
          durationMs: Date.now() - t0,
        });
        statusStore.recordHeartbeat(count, true);
      } catch (err: unknown) {
        const msg = (err as Error).message;
        logger.error('Heartbeat', '轮询失败', { error: msg, durationMs: Date.now() - t0 });
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
