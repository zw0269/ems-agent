import { LLMClient } from '../llm/client.js';
import { ToolRouter } from './toolRouter.js';
import { ContextManager } from './contextManager.js';
import type { Alarm, LLMResponse } from '../types/index.js';
import { buildSystemPrompt, buildUserMessage } from '../llm/prompts.js';
import { TOOLS_DEFINITION } from '../tools/index.js';

/**
 * Agent 运行时核心
 * 硬件故障：单次 LLM 调用（runOnce）
 * 软件故障：while 循环 + 工具调用（run）
 */
export class AgentLoop {
  private llm: LLMClient;
  private toolRouter: ToolRouter;
  private maxIterations = 10;

  constructor() {
    this.llm = new LLMClient();
    this.toolRouter = new ToolRouter();
  }

  /**
   * 硬件故障：单次调用，直接生成报告
   */
  async runOnce(
    alarm: Alarm,
    realtime: any,
    history: any,
    violations: any[],
  ): Promise<string> {
    console.log(`[AgentLoop] 执行硬件故障单次分析: ${alarm.alarmId}`);

    const ctx = new ContextManager();
    ctx.addSystem(buildSystemPrompt('hardware'));
    ctx.addUser(buildUserMessage(alarm, { realtime, history, violations }));

    const response: LLMResponse = await this.llm.call(ctx.get());
    return response.text ?? '[Agent] 未能生成硬件分析报告。';
  }

  /**
   * 软件/配置故障：while 循环核心
   * LLM 按需调用工具，直到返回 final_answer 或达到最大迭代次数
   */
  async run(
    alarm: Alarm,
    initialData: { realtime: object; history: object; violations: object[] },
  ): Promise<string> {
    console.log(`[AgentLoop] 执行软件故障循环分析: ${alarm.alarmId}`);

    const ctx = new ContextManager();
    ctx.addSystem(buildSystemPrompt('software'));
    ctx.addUser(buildUserMessage(alarm, initialData));

    for (let i = 0; i < this.maxIterations; i++) {
      console.log(`[AgentLoop] 迭代次数: ${i + 1}/${this.maxIterations}`);

      const response: LLMResponse = await this.llm.call(ctx.get(), TOOLS_DEFINITION);

      if (response.type === 'final_answer') {
        console.log(`[AgentLoop] 获得最终分析结果: ${alarm.alarmId}`);
        return response.text ?? '[Agent] 分析完成，但未返回具体结论。';
      }

      if (response.type === 'tool_call' && response.toolName) {
        const callId = response.toolCallId ?? `call_${Date.now()}`;
        console.log(`[AgentLoop] LLM 调用工具: ${response.toolName} (id=${callId})`);

        // 记录 assistant 消息，携带 toolCallId（OpenAI / Anthropic 格式均需要）
        ctx.addAssistant('', [{
          id: callId,
          name: response.toolName,
          args: response.args,
        }]);

        // 执行工具
        const result = await this.toolRouter.run(response.toolName, response.args);

        // 记录工具结果，toolCallId 与上方 assistant 消息对应
        ctx.addToolResult(response.toolName, result, callId);
        continue;
      }
    }

    console.warn(`[AgentLoop] 超过最大迭代次数 ${this.maxIterations}，强制终止`);
    return `[Agent] 分析超时，已达最大迭代次数 ${this.maxIterations}，请人工介入。`;
  }
}
