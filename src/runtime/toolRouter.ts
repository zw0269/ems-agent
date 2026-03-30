import { queryBms } from '../tools/queryBms.js';
import { queryHistory } from '../tools/queryHistory.js';
import { logger } from '../utils/logger.js';

/**
 * 工具路由器
 * 根据 toolName 路由到对应 tool 函数，并记录每次执行结果
 */
export class ToolRouter {
  async run(toolName: string, args: any): Promise<any> {
    const t0 = Date.now();
    logger.info('ToolRouter', `工具执行开始：${toolName}`, {
      tool: toolName,
      args,
    });

    try {
      let result: any;
      switch (toolName) {
        case 'queryBms':
        case 'queryPcs':
          result = await queryBms(args);
          break;
        case 'queryHistory':
          result = await queryHistory(args);
          break;
        default:
          throw new Error(`未知工具: ${toolName}`);
      }

      logger.info('ToolRouter', `工具执行成功：${toolName}`, {
        tool: toolName,
        durationMs: Date.now() - t0,
      });
      return result;
    } catch (error: unknown) {
      const msg = (error as Error).message;
      logger.error('ToolRouter', `工具执行失败：${toolName}`, {
        tool: toolName,
        error: msg,
        durationMs: Date.now() - t0,
      });
      return { error: msg, hint: '请尝试更换参数或减少查询点位' };
    }
  }
}
