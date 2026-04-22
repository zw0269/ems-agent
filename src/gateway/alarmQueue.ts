import type { Alarm } from '../types/index.js';
import { SessionManager } from './sessionManager.js';
import { PRIORITY_ORDER } from '../config/alarmPriority.js';

/**
 * 告警去重 + 优先级队列
 * 防止同一告警在处理期间被重复触发
 */
export class AlarmQueue {
  private pending: Alarm[] = [];
  private sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * 推入告警（去重 + 优先级排序）
   */
  push(alarm: Alarm) {
    // 去重：正在处理中的告警不重复入队
    if (this.sessionManager.isProcessing(alarm.alarmId)) {
      console.log(`[Queue] 告警 ${alarm.alarmId} 正在处理中，忽略入队`);
      return;
    }

    // 检查是否已经在等待队列中
    if (this.pending.some(a => a.alarmId === alarm.alarmId)) {
      return;
    }

    this.pending.push(alarm);
    
    // 优先级排序（P3 最严重，最优先）
    this.pending.sort((a, b) => {
      const pA = PRIORITY_ORDER[a.priority] ?? 2;
      const pB = PRIORITY_ORDER[b.priority] ?? 2;
      return pA - pB;
    });

    console.log(`[Queue] 告警 ${alarm.alarmId} 入队成功，当前队列长度: ${this.pending.length}`);
  }

  /**
   * 弹出优先级最高的告警
   */
  pop(): Alarm | undefined {
    return this.pending.shift();
  }

  /**
   * 弹出指定优先级的第一个告警（不影响其他优先级的顺序）
   * 用于 P3 独立消费者快速通道
   */
  popByPriority(priority: string): Alarm | undefined {
    const idx = this.pending.findIndex(a => a.priority === priority);
    if (idx === -1) return undefined;
    return this.pending.splice(idx, 1)[0];
  }

  get length(): number {
    return this.pending.length;
  }
}
