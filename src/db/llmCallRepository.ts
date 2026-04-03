import { getDb } from './database.js';
import { logger } from '../utils/logger.js';
import type { Message, LLMResponse } from '../types/index.js';

export interface LlmCallRecord {
  id: number;
  alarm_id: string;
  call_index: number;
  provider: string;
  model: string;
  input_messages: string;
  output_json: string;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  created_at: string;
}

function nowBeijing(): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 记录一次 LLM API 调用（输入消息 + 输出结果）
 */
export function insertLlmCall(params: {
  alarmId: string;
  callIndex: number;
  provider: string;
  model: string;
  inputMessages: Message[];
  output: LLMResponse;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}): void {
  try {
    getDb().prepare(`
      INSERT INTO llm_calls
        (alarm_id, call_index, provider, model, input_messages, output_json, duration_ms, input_tokens, output_tokens, created_at)
      VALUES
        (@alarm_id, @call_index, @provider, @model, @input_messages, @output_json, @duration_ms, @input_tokens, @output_tokens, @created_at)
    `).run({
      alarm_id:       params.alarmId,
      call_index:     params.callIndex,
      provider:       params.provider,
      model:          params.model,
      input_messages: JSON.stringify(params.inputMessages),
      output_json:    JSON.stringify(params.output),
      duration_ms:    params.durationMs,
      input_tokens:   params.inputTokens  ?? 0,
      output_tokens:  params.outputTokens ?? 0,
      created_at:     nowBeijing(),
    });
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '写入 LLM 调用记录失败', {
      alarmId: params.alarmId,
      error: (err as Error).message,
    });
  }
}

/**
 * 查询某次告警的所有 LLM 调用记录
 */
export function queryLlmCallsByAlarm(alarmId: string): LlmCallRecord[] {
  try {
    return getDb()
      .prepare('SELECT * FROM llm_calls WHERE alarm_id = ? ORDER BY call_index ASC')
      .all(alarmId) as LlmCallRecord[];
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '查询 LLM 调用记录失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 查询最近 N 条 LLM 调用记录
 */
export function queryRecentLlmCalls(limit = 50): LlmCallRecord[] {
  try {
    return getDb()
      .prepare('SELECT * FROM llm_calls ORDER BY created_at DESC LIMIT ?')
      .all(limit) as LlmCallRecord[];
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '查询最近 LLM 调用记录失败', { error: (err as Error).message });
    return [];
  }
}
