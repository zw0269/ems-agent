import type { Message, ToolCall } from '../types/index.js';

/**
 * 上下文管理器
 * 管理消息历史，估算 token，并执行压缩策略
 */
export class ContextManager {
  private messages: Message[] = [];
  private estimatedTokens = 0;
  private readonly TOKEN_LIMIT = 100_000;

  private estimate(content: string): number {
    return Math.ceil(content.length / 4);
  }

  addSystem(content: string) {
    this.messages.push({ role: 'system', content });
    this.estimatedTokens += this.estimate(content);
  }

  addUser(content: string) {
    this.messages.push({ role: 'user', content });
    this.estimatedTokens += this.estimate(content);
  }

  /**
   * 记录 assistant 消息
   * toolCalls 中的 id 来自 LLMClient 解析 LLM 响应，确保与后续 tool_call_id 一致
   */
  addAssistant(content: string, toolCalls?: Array<{ id: string; name: string; args: any }>) {
    const msg: Message = { role: 'assistant', content };

    if (toolCalls?.length) {
      const formattedToolCalls: ToolCall[] = toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
      msg.tool_calls = formattedToolCalls;
    }

    this.messages.push(msg);
    this.estimatedTokens += this.estimate(content);
  }

  /**
   * 记录工具返回结果
   * toolCallId 须与 addAssistant 中对应 toolCall 的 id 一致
   */
  addToolResult(toolName: string, result: any, toolCallId?: string) {
    const content = JSON.stringify(result);
    const msg: Message = { role: 'tool', name: toolName, content };
    if (toolCallId) msg.tool_call_id = toolCallId;
    this.messages.push(msg);
    this.estimatedTokens += this.estimate(content);

    if (this.estimatedTokens > this.TOKEN_LIMIT * 0.8) {
      this.compact();
    }
  }

  /**
   * 压缩策略 (compact)
   * 保留 system + 第一条 user，压缩中间的 tool 历史
   */
  private compact() {
    console.warn('[ContextManager] 接近 token 上限，执行 compact');
    if (this.messages.length <= 3) return;

    const systemMsg = this.messages.find(m => m.role === 'system');
    const firstUserMsg = this.messages.find(m => m.role === 'user');
    const lastMsgs = this.messages.slice(-3);

    this.messages = [];
    if (systemMsg) this.messages.push(systemMsg);
    if (firstUserMsg) this.messages.push(firstUserMsg);

    this.messages.push({
      role: 'user',
      content: '... [此处已压缩早期中间推理过程，请基于当前状态继续分析] ...',
    });
    this.messages.push(...lastMsgs);

    this.estimatedTokens = this.messages.reduce(
      (sum, m) => sum + this.estimate(m.content),
      0,
    );
  }

  get(): Message[] {
    return this.messages;
  }
}
