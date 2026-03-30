import { queryBms } from '../tools/queryBms.js';
import { queryHistory } from '../tools/queryHistory.js';

/**
 * 工具路由器
 * 根据 toolName 路由到对应 tool 函数，并执行错误捕获
 */
export class ToolRouter {
  /**
   * 路由执行工具
   * 工具执行失败时捕获错误，返回错误信息注入 context（让 LLM 感知）
   */
  async run(toolName: string, args: any): Promise<any> {
    try {
      console.log(`[ToolRouter] 正在执行工具: ${toolName}, 参数: ${JSON.stringify(args)}`);
      
      switch (toolName) {
        case 'queryBms':
          return await queryBms(args);
        case 'queryPcs':
          // 在本示例中，PCS 也是通过 queryBms 类似的接口查询，或复用 queryBms 逻辑
          return await queryBms(args);
        case 'queryHistory':
          return await queryHistory(args);
        default:
          throw new Error(`未知工具: ${toolName}`);
      }
    } catch (error) {
      console.error(`[ToolRouter] 工具 ${toolName} 执行失败: ${(error as Error).message}`);
      return {
        error: (error as Error).message,
        hint: '请尝试更换参数或减少查询点位'
      };
    }
  }
}
