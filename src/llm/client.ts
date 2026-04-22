import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import crypto from 'crypto';
import type { LLMResponse, Message, ToolCall } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { insertLlmCall } from '../db/llmCallRepository.js';

export interface LlmCallContext {
  alarmId?: string | undefined;
  callIndex?: number | undefined;
  /** E4 Shadow Mode 分组；不传默认 'prod' */
  shadowGroup?: string | undefined;
  /** E5 可复现性：OpenAI seed；不传则用 alarmId 派生 */
  seedOverride?: number | undefined;
}

export interface LlmCallResult extends LLMResponse {
  /** 本次调用统计（E1/E2/E5/E6 复用） */
  stats: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

export type LLMProviderType = 'anthropic' | 'openai' | 'openai-compatible';

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** 将 alarmId 派生为 OpenAI seed（非负 32 位整数） */
function deriveSeed(alarmId: string | undefined): number | undefined {
  if (!alarmId) return undefined;
  const hex = sha256(alarmId).slice(0, 8);
  return parseInt(hex, 16);
}

export class LLMClient {
  private provider: LLMProviderType;
  private model: string;
  private maxRetries: number;
  private temperature: number;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;

  constructor() {
    this.provider   = (process.env['LLM_PROVIDER'] as LLMProviderType) ?? 'anthropic';
    this.model      = process.env['LLM_MODEL'] ?? this.defaultModel();
    this.maxRetries = parseInt(process.env['LLM_MAX_RETRIES'] ?? '3', 10);
    this.temperature = parseFloat(process.env['LLM_TEMPERATURE'] ?? '0.1');

    if (this.provider === 'anthropic') {
      this.anthropicClient = new Anthropic({ apiKey: process.env['LLM_API_KEY'] });
    } else {
      const baseURL = process.env['LLM_BASE_URL'];
      this.openaiClient = new OpenAI({
        apiKey: process.env['LLM_API_KEY'] ?? '',
        ...(baseURL ? { baseURL } : {}),
      });
    }

    logger.info('LLMClient', 'LLM 客户端初始化', {
      provider: this.provider,
      model: this.model,
      temperature: this.temperature,
      baseURL: process.env['LLM_BASE_URL'] ?? '(official)',
    });
  }

  private defaultModel(): string {
    switch (this.provider) {
      case 'anthropic': return 'claude-opus-4-6';
      case 'openai':    return 'gpt-4o';
      default:          return 'gpt-4o';
    }
  }

  /**
   * 统一调用入口，带指数退避重试。
   * 每次调用（含重试）都写入日志 + llm_calls 表，包含 prompt_hash、cache 命中、shadow 分组等审计字段。
   */
  async call(messages: Message[], tools?: any[], context?: LlmCallContext): Promise<LlmCallResult> {
    let lastError: Error | undefined;
    const t0 = Date.now();

    // R5：对 system prompt 计哈希，用于回溯"这条告警当时用的是哪版提示词"
    const systemMsg = messages.find(m => m.role === 'system');
    const promptHash = sha256(systemMsg?.content ?? '');
    const shadowGroup = context?.shadowGroup ?? 'prod';

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const { response: result, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } =
          this.provider === 'anthropic'
            ? await this.callAnthropic(messages, tools)
            : await this.callOpenAI(messages, tools, context);

        const durationMs = Date.now() - attemptStart;

        logger.info('LLMClient', 'API 调用成功', {
          provider: this.provider,
          model: this.model,
          attempt: attempt + 1,
          responseType: result.type,
          toolName: result.toolName,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          promptHash: promptHash.slice(0, 12),
          shadowGroup,
          durationMs,
          totalMs: Date.now() - t0,
        });

        insertLlmCall({
          alarmId:          context?.alarmId   ?? '',
          callIndex:        context?.callIndex ?? 0,
          provider:         this.provider,
          model:            this.model,
          inputMessages:    messages,
          output:           result,
          durationMs,
          inputTokens,
          outputTokens,
          promptHash,
          shadowGroup,
          cacheReadTokens,
          cacheWriteTokens,
          toolName:         result.type === 'tool_call' ? result.toolName ?? null : null,
          isError:          false,
        });

        return { ...result, stats: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } };
      } catch (error: unknown) {
        lastError = error as Error;
        logger.warn('LLMClient', `API 调用失败（第 ${attempt + 1} 次）`, {
          provider: this.provider,
          model: this.model,
          attempt: attempt + 1,
          error: (error as Error).message,
          durationMs: Date.now() - attemptStart,
        });

        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    logger.error('LLMClient', 'API 调用最终失败，已耗尽重试次数', {
      provider: this.provider,
      model: this.model,
      maxRetries: this.maxRetries,
      error: lastError?.message,
      totalMs: Date.now() - t0,
    });

    // 审计：失败也写一条（is_error=1），保证"每次 LLM 调用都有回执"
    insertLlmCall({
      alarmId:       context?.alarmId   ?? '',
      callIndex:     context?.callIndex ?? 0,
      provider:      this.provider,
      model:         this.model,
      inputMessages: messages,
      output:        { type: 'final_answer', text: `ERROR: ${lastError?.message ?? 'unknown'}` },
      durationMs:    Date.now() - t0,
      inputTokens:   0,
      outputTokens:  0,
      promptHash,
      shadowGroup,
      isError:       true,
    });

    throw lastError;
  }

  // ─── Anthropic ────────────────────────────────────────────────────────────

  private async callAnthropic(messages: Message[], tools?: any[]): Promise<{
    response: LLMResponse;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }> {
    const systemMsg = messages.find(m => m.role === 'system');
    const anthropicMessages = toAnthropicMessages(messages);
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map(t => ({
      name: t.name as string,
      description: t.description as string,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    // E1 Prompt Caching：system prompt 用 block 格式，最后一个 block 加 ephemeral cache
    // 20 轮循环中后 19 轮按 10% 价格命中
    const systemBlocks: Anthropic.TextBlockParam[] | undefined = systemMsg?.content
      ? [{ type: 'text', text: systemMsg.content, cache_control: { type: 'ephemeral' } }]
      : undefined;

    const raw = await this.anthropicClient!.messages.create({
      model: this.model,
      max_tokens: 4096,
      temperature: this.temperature,
      ...(systemBlocks ? { system: systemBlocks } : {}),
      messages: anthropicMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    });

    const inputTokens       = raw.usage?.input_tokens                ?? 0;
    const outputTokens      = raw.usage?.output_tokens               ?? 0;
    const cacheReadTokens   = (raw.usage as any)?.cache_read_input_tokens     ?? 0;
    const cacheWriteTokens  = (raw.usage as any)?.cache_creation_input_tokens ?? 0;

    for (const block of raw.content) {
      if (block.type === 'tool_use') {
        return {
          response: { type: 'tool_call', toolName: block.name, toolCallId: block.id, args: block.input },
          inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
        };
      }
    }
    const textBlock = raw.content.find(b => b.type === 'text');
    return {
      response: { type: 'final_answer', text: textBlock?.type === 'text' ? textBlock.text : '' },
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    };
  }

  // ─── OpenAI / OpenAI-Compatible ───────────────────────────────────────────

  private async callOpenAI(messages: Message[], tools?: any[], context?: LlmCallContext): Promise<{
    response: LLMResponse;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }> {
    const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: t,
    }));

    const seed = context?.seedOverride ?? deriveSeed(context?.alarmId);

    const raw = await this.openaiClient!.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: this.temperature,
      ...(seed !== undefined ? { seed } : {}),
      ...(openaiTools?.length ? { tools: openaiTools, tool_choice: 'auto' as const } : {}),
    });

    const inputTokens       = raw.usage?.prompt_tokens     ?? 0;
    const outputTokens      = raw.usage?.completion_tokens ?? 0;
    const cacheReadTokens   = (raw.usage as any)?.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheWriteTokens  = 0; // OpenAI 无显式 write 统计

    const message = raw.choices[0]?.message;
    if (!message) throw new Error('LLM 返回空响应');

    if (message.tool_calls?.length) {
      const tc = message.tool_calls[0]!;
      return {
        response: {
          type: 'tool_call',
          toolName: tc.function.name,
          toolCallId: tc.id,
          args: JSON.parse(tc.function.arguments),
        },
        inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
      };
    }
    return {
      response: { type: 'final_answer', text: message.content ?? '' },
      inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    };
  }
}

// ─── Internal → Anthropic message converter ──────────────────────────────

function toAnthropicMessages(messages: Message[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls?.length) {
        result.push({
          role: 'assistant',
          content: msg.tool_calls.map((tc: ToolCall) => ({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
          })),
        });
      } else {
        result.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool') {
      const toolResult: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id ?? msg.name ?? 'unknown',
        content: msg.content,
      };
      const last = result[result.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(toolResult);
      } else {
        result.push({ role: 'user', content: [toolResult] });
      }
    }
  }

  return result;
}
