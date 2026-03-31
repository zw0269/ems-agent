import { LLMClient } from '../llm/client.js';
import { ToolRouter } from './toolRouter.js';
import { ContextManager } from './contextManager.js';
import type { Alarm, LLMResponse } from '../types/index.js';
import { buildSystemPrompt, buildUserMessage, buildSelfReflectionPrompt } from '../llm/prompts.js';
import { TOOLS_DEFINITION } from '../tools/index.js';
import { logger } from '../utils/logger.js';
import { insertSelfImprovement } from '../db/selfImprovementRepository.js';

/**
 * Agent 运行时核心
 * 硬件故障：单次 LLM 调用（runOnce）
 * 软件故障：while 循环 + 工具调用（run）
 */
export class AgentLoop {
  private llm: LLMClient;
  private toolRouter: ToolRouter;
  private maxIterations = 30;

  constructor() {
    this.llm = new LLMClient();
    this.toolRouter = new ToolRouter();
  }

  /**
   * 硬件故障：单次调用，直接生成报告
   */
  async runOnce(alarm: Alarm, realtime: any, history: any, violations: any[]): Promise<string> {
    const t0 = Date.now();
    logger.info('AgentLoop', '硬件故障分析开始（单次调用）', {
      alarmId: alarm.alarmId,
      alarmType: alarm.alarmType,
      priority: alarm.priority,
      violationCount: violations.length,
    });

    const ctx = new ContextManager();
    ctx.addSystem(buildSystemPrompt('hardware'));
    ctx.addUser(buildUserMessage(alarm, { realtime, history, violations }));

    const response: LLMResponse = await this.llm.call(
      ctx.get(),
      undefined,
      { alarmId: alarm.alarmId, callIndex: 0 },
    );
    const conclusion = response.text?.trim() || '[Agent] LLM 返回内容为空，请检查模型配置或日志。';

    logger.info('AgentLoop', '硬件故障分析完成', {
      alarmId: alarm.alarmId,
      conclusionLength: conclusion.length,
      durationMs: Date.now() - t0,
    });

    await this.runSelfReflection(alarm, conclusion, 1);

    return conclusion;
  }

  /**
   * 软件/配置故障：while 循环核心
   * LLM 按需调用工具，直到返回 final_answer 或达到最大迭代次数
   */
  async run(
    alarm: Alarm,
    initialData: { realtime: object; history: object; violations: object[] },
  ): Promise<string> {
    const t0 = Date.now();
    logger.info('AgentLoop', '软件故障分析开始（Agent Loop）', {
      alarmId: alarm.alarmId,
      alarmType: alarm.alarmType,
      priority: alarm.priority,
      maxIterations: this.maxIterations,
    });

    const ctx = new ContextManager();
    ctx.addSystem(buildSystemPrompt('software'));
    ctx.addUser(buildUserMessage(alarm, initialData));

    for (let i = 0; i < this.maxIterations; i++) {
      logger.info('AgentLoop', `迭代 ${i + 1}/${this.maxIterations}`, {
        alarmId: alarm.alarmId,
        iteration: i + 1,
      });

      const response: LLMResponse = await this.llm.call(
        ctx.get(),
        TOOLS_DEFINITION,
        { alarmId: alarm.alarmId, callIndex: i },
      );

      if (response.type === 'final_answer') {
        const conclusion = response.text?.trim() || '[Agent] LLM 返回内容为空，请检查模型配置或日志。';
        logger.info('AgentLoop', '软件故障分析完成，获得最终结论', {
          alarmId: alarm.alarmId,
          iterations: i + 1,
          conclusionLength: conclusion.length,
          durationMs: Date.now() - t0,
        });

        await this.runSelfReflection(alarm, conclusion, i + 1);

        return conclusion;
      }

      if (response.type === 'tool_call' && response.toolName) {
        const callId = response.toolCallId ?? `call_${Date.now()}`;
        logger.info('AgentLoop', 'AI 决策：调用工具', {
          alarmId: alarm.alarmId,
          iteration: i + 1,
          tool: response.toolName,
          callId,
          args: response.args,
        });

        ctx.addAssistant('', [{ id: callId, name: response.toolName, args: response.args }]);
        const result = await this.toolRouter.run(response.toolName, response.args);
        ctx.addToolResult(response.toolName, result, callId);
        continue;
      }
    }

    const fallback = `[Agent] 分析超时，已达最大迭代次数 ${this.maxIterations}，请人工介入。`;
    logger.warn('AgentLoop', '超过最大迭代次数，强制终止', {
      alarmId: alarm.alarmId,
      maxIterations: this.maxIterations,
      durationMs: Date.now() - t0,
    });

    await this.runSelfReflection(alarm, fallback, this.maxIterations);

    return fallback;
  }

  /**
   * 自我反思：告警处理完成后，让 LLM 对本次分析过程提出改进建议
   * 建议保存到数据库，供用户在 Web UI 审阅和反馈
   * 此方法内部不抛出异常，失败仅记录日志
   */
  private async runSelfReflection(alarm: Alarm, conclusion: string, iterationCount: number): Promise<void> {
    try {
      const { system, user } = buildSelfReflectionPrompt(alarm, conclusion, iterationCount);
      const reflCtx = new ContextManager();
      reflCtx.addSystem(system);
      reflCtx.addUser(user);

      const response: LLMResponse = await this.llm.call(
        reflCtx.get(),
        undefined,
        { alarmId: alarm.alarmId, callIndex: -1 },
      );

      const suggestion = response.text?.trim() ?? '';
      if (suggestion) {
        insertSelfImprovement(alarm.alarmId, suggestion);
        logger.info('AgentLoop', '已保存 AI 自我改进建议', {
          alarmId: alarm.alarmId,
          suggestionLength: suggestion.length,
        });
      }
    } catch (err: unknown) {
      logger.warn('AgentLoop', '自我反思调用失败（不影响主流程）', {
        alarmId: alarm.alarmId,
        error: (err as Error).message,
      });
    }
  }
}
