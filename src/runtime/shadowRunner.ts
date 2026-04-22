import { LLMClient } from '../llm/client.js';
import { ContextManager } from './contextManager.js';
import { buildSystemPrompt, buildUserMessage } from '../llm/prompts.js';
import type { Alarm } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * E4 Shadow Mode Runner
 *
 * 目的：在生产 prompt 跑的同时，用候选 prompt 对同一告警做一次单轮推理，
 *       结果写入 llm_calls 表（shadow_group='shadow'），不发通知、不入 alarm_records。
 *       供运维在 Web 面板对比"prod vs shadow"结论，以验证新版 prompt 是否值得上线。
 *
 * 触发方式：设置环境变量 SHADOW_ENABLED=true；
 * prompt 差异：通过 SHADOW_PROMPT_APPEND（字符串）追加到 system prompt 末尾，
 *              比如验证"新规则 R6"的效果时直接把 R6 放进这个 env。
 *
 * 注意：shadow 只跑单轮（不进 tool loop），避免成本失控。
 */
export class ShadowRunner {
  private llm: LLMClient;

  constructor() {
    this.llm = new LLMClient();
  }

  static isEnabled(): boolean {
    return process.env['SHADOW_ENABLED'] === 'true';
  }

  async run(
    alarm: Alarm,
    initialData: { realtime: object; history: object; violations: object[] },
  ): Promise<void> {
    try {
      const append = process.env['SHADOW_PROMPT_APPEND'] ?? '';
      if (!append) {
        logger.warn('ShadowRunner', 'SHADOW_ENABLED 开启但未配置 SHADOW_PROMPT_APPEND，跳过');
        return;
      }

      const ctx = new ContextManager();
      ctx.addSystem(buildSystemPrompt(alarm.faultCategory) + '\n\n【Shadow 候选补丁】\n' + append);
      ctx.addUser(buildUserMessage(alarm, initialData));

      const t0 = Date.now();
      const response = await this.llm.call(
        ctx.get(),
        undefined, // 不给工具，仅对比结论差异
        { alarmId: alarm.alarmId, callIndex: 999, shadowGroup: 'shadow' },
      );
      logger.info('ShadowRunner', 'Shadow 推理完成', {
        alarmId: alarm.alarmId,
        responseType: response.type,
        inputTokens: response.stats.inputTokens,
        outputTokens: response.stats.outputTokens,
        durationMs: Date.now() - t0,
      });
    } catch (err: unknown) {
      logger.warn('ShadowRunner', 'Shadow 推理失败（不影响主流程）', {
        alarmId: alarm.alarmId,
        error: (err as Error).message,
      });
    }
  }
}
