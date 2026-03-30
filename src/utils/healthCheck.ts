import { LLMClient } from '../llm/client.js';
import { logger } from './logger.js';

/**
 * 启动时测试 LLM API 连通性
 */
export async function checkLLMConnectivity(): Promise<boolean> {
  const provider = process.env['LLM_PROVIDER'] ?? 'anthropic';
  const model    = process.env['LLM_MODEL'] ?? '(default)';
  const baseURL  = process.env['LLM_BASE_URL'] ?? '(official endpoint)';

  logger.info('HealthCheck', 'LLM API 连通性测试开始', { provider, model, baseURL });

  const client = new LLMClient();
  const t0 = Date.now();

  try {
    const response = await client.call([
      { role: 'user', content: 'Reply with exactly: OK' },
    ]);

    const reply = response.text?.trim() ?? '';
    logger.info('HealthCheck', 'LLM API 连通性测试通过', {
      provider,
      model,
      baseURL,
      reply,
      durationMs: Date.now() - t0,
    });
    return true;
  } catch (err: unknown) {
    logger.error('HealthCheck', 'LLM API 连通性测试失败', {
      provider,
      model,
      baseURL,
      error: (err as Error).message,
      durationMs: Date.now() - t0,
    });
    return false;
  }
}
