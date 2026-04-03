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
    // 补充 tool_calls 序列化内容的 token 估算（content 为空时 tool_calls 是主要 token 来源）
    if (toolCalls?.length) {
      this.estimatedTokens += this.estimate(JSON.stringify(toolCalls));
    }
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
   * 保留 system + 第一条 user，从末尾向前找到最近一对完整的
   * assistant(tool_use) + tool_result 配对之后的安全截断点，
   * 避免切断 Anthropic API 要求的 tool_use/tool_result 配对。
   */
  private compact() {
    console.warn('[ContextManager] 接近 token 上限，执行 compact');
    if (this.messages.length <= 3) return;

    const systemMsg  = this.messages.find(m => m.role === 'system');
    const firstUserMsg = this.messages.find(m => m.role === 'user');

    // 从末尾向前扫描，找到安全截断点：
    // 安全点 = 最近一个不含 tool_calls 的 assistant 消息，或最近一个 user 消息（非 tool_result）
    // 确保保留的末尾片段首消息是 user 或不含 tool_use 的 assistant
    let safeIdx = this.messages.length - 1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      // 如果找到一个 user 消息（不是 tool_result），这是安全截断点的起始位置
      if (m.role === 'user' && !m.tool_call_id) {
        safeIdx = i;
        break;
      }
    }

    // 保留 system + firstUser + 压缩占位符 + 安全点之后的所有消息
    const tailMsgs = this.messages.slice(safeIdx);

    this.messages = [];
    if (systemMsg)    this.messages.push(systemMsg);
    if (firstUserMsg && firstUserMsg !== tailMsgs[0]) {
      this.messages.push(firstUserMsg);
    }
    this.messages.push({
      role: 'user',
      content: '... [此处已压缩早期中间推理过程，请基于当前状态继续分析] ...',
    });
    this.messages.push(...tailMsgs);

    this.estimatedTokens = this.messages.reduce(
      (sum, m) => sum + this.estimate(m.content),
      0,
    );
  }

  get(): Message[] {
    return this.messages;
  }
}
