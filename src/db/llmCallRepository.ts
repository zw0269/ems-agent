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
  prompt_hash: string;
  shadow_group: string;
  cache_read_tokens: number;
  cache_write_tokens: number;
  tool_name: string | null;
  is_error: number;
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
  promptHash?: string;
  shadowGroup?: string;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolName?: string | null;
  isError?: boolean;
}): void {
  try {
    getDb().prepare(`
      INSERT INTO llm_calls
        (alarm_id, call_index, provider, model, input_messages, output_json,
         duration_ms, input_tokens, output_tokens,
         prompt_hash, shadow_group, cache_read_tokens, cache_write_tokens, tool_name, is_error,
         created_at)
      VALUES
        (@alarm_id, @call_index, @provider, @model, @input_messages, @output_json,
         @duration_ms, @input_tokens, @output_tokens,
         @prompt_hash, @shadow_group, @cache_read_tokens, @cache_write_tokens, @tool_name, @is_error,
         @created_at)
    `).run({
      alarm_id:           params.alarmId,
      call_index:         params.callIndex,
      provider:           params.provider,
      model:              params.model,
      input_messages:     JSON.stringify(params.inputMessages),
      output_json:        JSON.stringify(params.output),
      duration_ms:        params.durationMs,
      input_tokens:       params.inputTokens      ?? 0,
      output_tokens:      params.outputTokens     ?? 0,
      prompt_hash:        params.promptHash       ?? '',
      shadow_group:       params.shadowGroup      ?? 'prod',
      cache_read_tokens:  params.cacheReadTokens  ?? 0,
      cache_write_tokens: params.cacheWriteTokens ?? 0,
      tool_name:          params.toolName         ?? null,
      is_error:           params.isError ? 1 : 0,
      created_at:         nowBeijing(),
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
 * 查询 Token 用量统计（今日 / 累计）
 */
export function queryTokenStats(): {
  todayInput: number;
  todayOutput: number;
  totalInput: number;
  totalOutput: number;
  todayCalls: number;
  totalCalls: number;
} {
  try {
    const db = getDb();
    const todayRow = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),  0) AS input,
        COALESCE(SUM(output_tokens), 0) AS output,
        COUNT(*)                         AS calls
      FROM llm_calls
      WHERE created_at >= datetime('now', 'start of day', '+8 hours')
         OR created_at >= strftime('%Y-%m-%dT00:00:00+08:00', 'now', '+8 hours')
    `).get() as { input: number; output: number; calls: number };

    const totalRow = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),  0) AS input,
        COALESCE(SUM(output_tokens), 0) AS output,
        COUNT(*)                         AS calls
      FROM llm_calls
    `).get() as { input: number; output: number; calls: number };

    // 使用简单的按日期字符串前缀过滤（北京时间日期）
    const todayDate = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const todayRow2 = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),  0) AS input,
        COALESCE(SUM(output_tokens), 0) AS output,
        COUNT(*)                         AS calls
      FROM llm_calls
      WHERE created_at LIKE ?
    `).get(todayDate + '%') as { input: number; output: number; calls: number };

    return {
      todayInput:  todayRow2.input,
      todayOutput: todayRow2.output,
      todayCalls:  todayRow2.calls,
      totalInput:  totalRow.input,
      totalOutput: totalRow.output,
      totalCalls:  totalRow.calls,
    };
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '查询 Token 统计失败', { error: (err as Error).message });
    return { todayInput: 0, todayOutput: 0, todayCalls: 0, totalInput: 0, totalOutput: 0, totalCalls: 0 };
  }
}

/**
 * E6 指标聚合：最近 sinceHours 小时的 LLM 质量指标
 * 包含：总调用数、失败率、cache 命中率、平均 prompt_hash 版本数（漂移指标）
 */
export function queryLlmMetrics(sinceHours = 24): {
  sinceHours: number;
  totalCalls: number;
  errorCalls: number;
  errorRate: number;
  cacheHitRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  distinctPromptHashes: number;
  avgDurationMs: number;
} {
  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT
        COUNT(*)                                                            AS total_calls,
        SUM(is_error)                                                       AS error_calls,
        COALESCE(SUM(input_tokens),        0)                               AS in_tok,
        COALESCE(SUM(output_tokens),       0)                               AS out_tok,
        COALESCE(SUM(cache_read_tokens),   0)                               AS cache_read_tok,
        COALESCE(SUM(cache_write_tokens),  0)                               AS cache_write_tok,
        COUNT(DISTINCT prompt_hash)                                         AS distinct_hashes,
        COALESCE(AVG(duration_ms),         0)                               AS avg_dur
      FROM llm_calls
      WHERE created_at >= datetime('now', '-${sinceHours} hours')
    `).get() as {
      total_calls: number; error_calls: number;
      in_tok: number; out_tok: number;
      cache_read_tok: number; cache_write_tok: number;
      distinct_hashes: number; avg_dur: number;
    };

    const total = row.total_calls || 0;
    const cacheRead = row.cache_read_tok || 0;
    const cacheWrite = row.cache_write_tok || 0;
    const cacheHitRate = (cacheRead + cacheWrite) > 0
      ? cacheRead / (cacheRead + cacheWrite + (row.in_tok - cacheRead - cacheWrite))
      : 0;

    return {
      sinceHours,
      totalCalls:           total,
      errorCalls:           row.error_calls || 0,
      errorRate:            total > 0 ? (row.error_calls || 0) / total : 0,
      cacheHitRate:         Number.isFinite(cacheHitRate) ? cacheHitRate : 0,
      totalInputTokens:     row.in_tok,
      totalOutputTokens:    row.out_tok,
      totalCacheReadTokens: cacheRead,
      totalCacheWriteTokens: cacheWrite,
      distinctPromptHashes: row.distinct_hashes,
      avgDurationMs:        Math.round(row.avg_dur),
    };
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '查询 LLM 指标失败', { error: (err as Error).message });
    return {
      sinceHours, totalCalls: 0, errorCalls: 0, errorRate: 0, cacheHitRate: 0,
      totalInputTokens: 0, totalOutputTokens: 0, totalCacheReadTokens: 0, totalCacheWriteTokens: 0,
      distinctPromptHashes: 0, avgDurationMs: 0,
    };
  }
}

/**
 * E6 工具层指标：工具失败率（is_error=1 且 tool_name 非空）
 */
export function queryToolMetrics(sinceHours = 24): Array<{
  toolName: string;
  total: number;
  errors: number;
  errorRate: number;
  avgDurationMs: number;
}> {
  try {
    const rows = getDb().prepare(`
      SELECT
        tool_name                                         AS toolName,
        COUNT(*)                                          AS total,
        COALESCE(SUM(is_error), 0)                        AS errors,
        COALESCE(AVG(duration_ms), 0)                     AS avgDurationMs
      FROM llm_calls
      WHERE created_at >= datetime('now', '-${sinceHours} hours')
        AND tool_name IS NOT NULL
        AND tool_name != ''
      GROUP BY tool_name
      ORDER BY total DESC
    `).all() as Array<{ toolName: string; total: number; errors: number; avgDurationMs: number }>;
    return rows.map(r => ({
      ...r,
      errorRate: r.total > 0 ? r.errors / r.total : 0,
      avgDurationMs: Math.round(r.avgDurationMs),
    }));
  } catch {
    return [];
  }
}

/**
 * E4 Shadow 对比：按 alarmId 拉出 prod / shadow 的结论，供前端 side-by-side
 */
export function queryShadowComparison(alarmId: string): {
  alarmId: string;
  prod: LlmCallRecord[];
  shadow: LlmCallRecord[];
} {
  try {
    const all = getDb()
      .prepare('SELECT * FROM llm_calls WHERE alarm_id = ? ORDER BY call_index ASC, created_at ASC')
      .all(alarmId) as LlmCallRecord[];
    return {
      alarmId,
      prod:   all.filter(r => r.shadow_group === 'prod' || !r.shadow_group),
      shadow: all.filter(r => r.shadow_group === 'shadow'),
    };
  } catch (err: unknown) {
    logger.error('LlmCallRepository', '查询 shadow 对比失败', { alarmId, error: (err as Error).message });
    return { alarmId, prod: [], shadow: [] };
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
