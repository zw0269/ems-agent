import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMResponse, Message, ToolCall } from '../types/index.js';

/**
 * 支持的 LLM Provider 类型
 *
 * - anthropic         : 使用 @anthropic-ai/sdk 直连 Anthropic API
 * - openai            : 使用 openai SDK 直连 OpenAI API
 * - openai-compatible : 使用 openai SDK + 自定义 baseURL
 *                       兼容 DeepSeek / Qwen / Azure / Ollama 等任意 OpenAI 兼容接口
 */
export type LLMProviderType = 'anthropic' | 'openai' | 'openai-compatible';

/**
 * LLM 客户端 — 多 Provider 统一封装
 *
 * 环境变量配置：
 *   LLM_PROVIDER    = anthropic | openai | openai-compatible  (默认 anthropic)
 *   LLM_API_KEY     = 对应 Provider 的 API Key
 *   LLM_MODEL       = 模型名称（不填时使用 Provider 默认值）
 *   LLM_BASE_URL    = 仅 openai-compatible 时需要设置
 *                     示例：https://api.deepseek.com/v1
 *   LLM_MAX_RETRIES = 最大重试次数（默认 3）
 */
export class LLMClient {
  private provider: LLMProviderType;
  private model: string;
  private maxRetries: number;
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;

  constructor() {
    this.provider = (process.env['LLM_PROVIDER'] as LLMProviderType) ?? 'anthropic';
    this.model = process.env['LLM_MODEL'] ?? this.defaultModel();
    this.maxRetries = parseInt(process.env['LLM_MAX_RETRIES'] ?? '3', 10);

    if (this.provider === 'anthropic') {
      this.anthropicClient = new Anthropic({
        apiKey: process.env['LLM_API_KEY'],
      });
    } else {
      // openai 和 openai-compatible 均使用 openai SDK
      // openai-compatible 时通过 LLM_BASE_URL 指向自定义端点
      const baseURL = process.env['LLM_BASE_URL'];
      this.openaiClient = new OpenAI({
        apiKey: process.env['LLM_API_KEY'] ?? '',
        ...(baseURL ? { baseURL } : {}),
      });
    }

    console.log(`[LLM] Provider: ${this.provider}, Model: ${this.model}`);
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
   */
  async call(messages: Message[], tools?: any[]): Promise<LLMResponse> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        if (this.provider === 'anthropic') {
          return await this.callAnthropic(messages, tools);
        } else {
          return await this.callOpenAI(messages, tools);
        }
      } catch (error: unknown) {
        lastError = error as Error;
        console.warn(`[LLM] 第 ${attempt + 1} 次调用失败: ${(error as Error).message}`);

        if (attempt < this.maxRetries - 1) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    console.error(`[LLM] 调用最终失败，已重试 ${this.maxRetries} 次`);
    throw lastError;
  }

  // ─── Anthropic Provider ───────────────────────────────────────────────────

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
      // 使用条件展开，避免 exactOptionalPropertyTypes 下传递 undefined
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: anthropicMessages,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    });

    for (const block of response.content) {
      if (block.type === 'tool_use') {
        return {
          type: 'tool_call',
          toolName: block.name,
          toolCallId: block.id,
          args: block.input,
        };
      }
    }

    const textBlock = response.content.find(b => b.type === 'text');
    return {
      type: 'final_answer',
      text: textBlock?.type === 'text' ? textBlock.text : '',
    };
  }

  // ─── OpenAI / OpenAI-Compatible Provider ─────────────────────────────────

  private async callOpenAI(messages: Message[], tools?: any[]): Promise<LLMResponse> {
    const openaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map(t => ({
      type: 'function' as const,
      function: t,
    }));

    const response = await this.openaiClient!.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      // 条件展开，有工具时才传入 tools + tool_choice
      ...(openaiTools?.length
        ? { tools: openaiTools, tool_choice: 'auto' as const }
        : {}),
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

    return {
      type: 'final_answer',
      text: message.content ?? '',
    };
  }
}

// ─── Message Format Converter: Internal → Anthropic ──────────────────────

/**
 * 将内部 Message[] 转换为 Anthropic SDK 的 MessageParam[]
 *
 * 映射规则：
 *   system   → 跳过（由 callAnthropic 作为 system 参数单独传入）
 *   user     → { role: 'user', content: string }
 *   assistant（有 tool_calls）→ { role: 'assistant', content: [tool_use...] }
 *   assistant（无 tool_calls）→ { role: 'assistant', content: string }
 *   tool     → { role: 'user', content: [tool_result] }（合并到同一 user turn）
 */
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

      // 合并到上一个 user turn（如果已是 array）；否则新建 user turn
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
