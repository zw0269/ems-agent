import cron from 'node-cron';
import { fetchAlarms } from '../tools/queryBms.js';
import { AlarmQueue } from './alarmQueue.js';

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

  /**
   * 启动轮询
   * 捕获轮询异常，确保 Heartbeat 不会因单次失败而崩溃
   */
  start() {
    // 读取环境变量中的轮询间隔
    const envInterval = process.env.HEARTBEAT_INTERVAL_SECONDS;
    if (envInterval) {
      this.intervalSeconds = parseInt(envInterval, 10);
    }

    const schedule = `*/${this.intervalSeconds} * * * * *`;
    
    this.task = cron.schedule(schedule, async () => {
      try {
        console.log(`[Heartbeat] ${new Date().toISOString()} 开始轮询告警...`);
        const alarms = await fetchAlarms();
        
        if (alarms && Array.isArray(alarms)) {
          console.log(`[Heartbeat] 拉取到 ${alarms.length} 条告警`);
          for (const alarm of alarms) {
            this.queue.push(alarm);
          }
        }
      } catch (err) {
        console.error('[Heartbeat] 拉取告警失败:', (err as Error).message);
      }
    });

    console.log(`[Heartbeat] 启动，轮询间隔 ${this.intervalSeconds}s`);
  }

  /**
   * 停止轮询
   */
  stop() {
    if (this.task) {
      this.task.stop();
      console.log('[Heartbeat] 已停止');
    }
  }
}
