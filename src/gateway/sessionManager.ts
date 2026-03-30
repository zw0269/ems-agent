/**
 * 会话管理器
 * 防止同一告警在处理期间被重复触发
 * 包含 24 小时自动清理机制，防止内存泄漏
 */
export class SessionManager {
  // alarmId → 处理状态
  private sessions = new Map<string, 'processing' | 'done'>();

  /**
   * 检查告警是否正在处理中
   */
  isProcessing(alarmId: string): boolean {
    const status = this.sessions.get(alarmId);
    return status === 'processing';
  }

  /**
   * 标记告警开始处理
   */
  start(alarmId: string) {
    this.sessions.set(alarmId, 'processing');
    console.log(`[Session] 告警 ${alarmId} 进入处理状态`);
  }

  /**
   * 标记告警处理完成，并设置 24 小时后自动清理
   */
  finish(alarmId: string) {
    this.sessions.set(alarmId, 'done');
    console.log(`[Session] 告警 ${alarmId} 处理完成`);
    
    // 24 小时后清理（避免内存泄漏）
    setTimeout(() => {
      this.sessions.delete(alarmId);
      console.log(`[Session] 告警 ${alarmId} 已从会话缓存中清除`);
    }, 86400_000);
  }
}
