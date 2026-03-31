import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMResponse, Message, ToolCall } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { insertLlmCall } from '../db/llmCallRepository.js';

export interface LlmCallContext {
  alarmId?: string | undefined;
  callIndex?: number | undefined;
}

export type LLMProviderType = 'anthropic' | 'openai' | 'openai-compatible';

export class LLMClient {
  private provider: LLMProviderType;
  private model: string;
  private maxRetries: number;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;

  constructor() {
    this.provider = (process.env['LLM_PROVIDER'] as LLMProviderType) ?? 'anthropic';
    this.model    = process.env['LLM_MODEL'] ?? this.defaultModel();
    this.maxRetries = parseInt(process.env['LLM_MAX_RETRIES'] ?? '3', 10);

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
   * 统一调用入口，带指数退避重试
   * 每次调用（含重试）都写入日志
   */
  async call(messages: Message[], tools?: any[], context?: LlmCallContext): Promise<LLMResponse> {
    let lastError: Error | undefined;
    const t0 = Date.now();

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const result = this.provider === 'anthropic'
          ? await this.callAnthropic(messages, tools)
          : await this.callOpenAI(messages, tools);

        const durationMs = Date.now() - attemptStart;

        logger.info('LLMClient', 'API 调用成功', {
          provider: this.provider,
          model: this.model,
          attempt: attempt + 1,
          responseType: result.type,
          toolName: result.toolName,
          durationMs,
          totalMs: Date.now() - t0,
        });

        insertLlmCall({
          alarmId:       context?.alarmId    ?? '',
          callIndex:     context?.callIndex  ?? 0,
          provider:      this.provider,
          model:         this.model,
          inputMessages: messages,
          output:        result,
          durationMs,
        });

        return result;
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
    throw lastError;
  }

  // ─── Anthropic ────────────────────────────────────────────────────────────

  private async callAnthropic(messages: Message[], tools?: any[]): Promise<LLMResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const anthropicMessages = toAnthropicMessages(messages);
    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map(t => ({
      name: t.name as string,
      description: t.description as string,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const response = await this.anthropicClient!.messages.create({
      model: this.model,
      max_tokens: 4096,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    });

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        return { type: 'tool_call', toolName: block.name, toolCallId: block.id, args: block.input };
      }
    }
    const textBlock = response.content.find(b => b.type === 'text');
    return { type: 'final_answer', text: textBlock?.type === 'text' ? textBlock.text : '' };
  }

  // ─── OpenAI / OpenAI-Compatible ───────────────────────────────────────────

  private async callOpenAI(messages: Message[], tools?: any[]): Promise<LLMResponse> {
    const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: t,
    }));

    const response = await this.openaiClient!.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(openaiTools?.length ? { tools: openaiTools, tool_choice: 'auto' as const } : {}),
    });

    const message = response.choices[0]?.message;
    if (!message) throw new Error('LLM 返回空响应');

    if (message.tool_calls?.length) {
      const tc = message.tool_calls[0]!;
      return {
        type: 'tool_call',
        toolName: tc.function.name,
        toolCallId: tc.id,
        args: JSON.parse(tc.function.arguments),
      };
    }
    return { type: 'final_answer', text: message.content ?? '' };
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
