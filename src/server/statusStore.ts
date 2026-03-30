/**
 * 全局状态存储（单例）
 * 供 Heartbeat、AgentLoop、index.ts 写入；StatusServer 读取展示
 */

export interface AlarmEvent {
  alarmId: string;
  alarmType: string;
  faultCategory: string;
  priority: string;
  startedAt: string;
  finishedAt?: string | undefined;
  durationMs?: number | undefined;
  status: 'processing' | 'done' | 'error';
  conclusion?: string | undefined;
}

export interface HeartbeatRecord {
  time: string;
  alarmCount: number;
  ok: boolean;
  error?: string | undefined;
}

export interface AgentStatus {
  startedAt: string;
  llmProvider: string;
  llmModel: string;
  llmBaseUrl: string;
  llmApiOk: boolean | null;          // null = 未测试
  queueLength: number;
  activeSessionCount: number;
  totalProcessed: number;
  totalErrors: number;
  lastHeartbeat: HeartbeatRecord | null;
  recentAlarms: AlarmEvent[];        // 最近 20 条
}

class StatusStore {
  private state: AgentStatus = {
    startedAt: new Date().toISOString(),
    llmProvider: process.env['LLM_PROVIDER'] ?? 'anthropic',
    llmModel: process.env['LLM_MODEL'] ?? '(default)',
    llmBaseUrl: process.env['LLM_BASE_URL'] ?? '(official endpoint)',
    llmApiOk: null,
    queueLength: 0,
    activeSessionCount: 0,
    totalProcessed: 0,
    totalErrors: 0,
    lastHeartbeat: null,
    recentAlarms: [],
  };

  get(): AgentStatus {
    return { ...this.state, recentAlarms: [...this.state.recentAlarms] };
  }

  setLLMApiStatus(ok: boolean) {
    this.state.llmApiOk = ok;
  }

  updateQueueLength(n: number) {
    this.state.queueLength = n;
  }

  updateSessionCount(n: number) {
    this.state.activeSessionCount = n;
  }

  recordHeartbeat(alarmCount: number, ok: boolean, error?: string) {
    this.state.lastHeartbeat = {
      time: new Date().toISOString(),
      alarmCount,
      ok,
      ...(error ? { error } : {}),
    };
  }

  startAlarm(alarm: { alarmId: string; alarmType: string; faultCategory: string; priority: string }) {
    const event: AlarmEvent = {
      ...alarm,
      startedAt: new Date().toISOString(),
      status: 'processing',
    };
    this.state.recentAlarms.unshift(event);
    if (this.state.recentAlarms.length > 20) {
      this.state.recentAlarms.pop();
    }
  }

  finishAlarm(alarmId: string, conclusion: string, isError = false) {
    const event = this.state.recentAlarms.find(e => e.alarmId === alarmId);
    if (event) {
      event.finishedAt = new Date().toISOString();
      event.durationMs = new Date(event.finishedAt).getTime() - new Date(event.startedAt).getTime();
      event.status = isError ? 'error' : 'done';
      event.conclusion = conclusion.slice(0, 200); // 截取前 200 字符
    }
    if (isError) {
      this.state.totalErrors++;
    } else {
      this.state.totalProcessed++;
    }
  }
}

// 单例导出
export const statusStore = new StatusStore();
