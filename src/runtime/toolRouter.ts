import { getHomePage, getBmsYx, getPcsYc, getPcsYx, getDcdcYc, getDcdcYx, getMeterYc, getMeterYx, getRealTimeAlarms, getHistoryAlarms, queryPcs } from '../tools/queryEms.js';
import { TOOLS_DEFINITION } from '../tools/index.js';
import { logger } from '../utils/logger.js';

type JsonSchema = {
  type: 'object';
  properties?: Record<string, { type: string; items?: { type: string }; description?: string }>;
  required?: string[];
};

const SCHEMA_MAP: Record<string, JsonSchema> = Object.fromEntries(
  TOOLS_DEFINITION.map(t => [t.name, t.parameters as JsonSchema]),
);

/**
 * R3 工具参数 schema 校验
 * 拒绝 LLM 幻觉出的非法 tool_use 参数，防止异常值到达 HTTP 客户端
 * 返回 null 表示校验通过；否则返回一句话错误原因
 */
function validateToolArgs(toolName: string, args: unknown): string | null {
  const schema = SCHEMA_MAP[toolName];
  if (!schema) return `未知工具: ${toolName}`;

  // 允许 LLM 在无参数工具上传 undefined / null / {}
  if (args === undefined || args === null) {
    if (schema.required?.length) return `工具 ${toolName} 缺少必填参数: ${schema.required.join(', ')}`;
    return null;
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return `工具 ${toolName} args 必须是对象，实际: ${typeof args}`;
  }

  const obj = args as Record<string, unknown>;

  for (const req of schema.required ?? []) {
    if (!(req in obj) || obj[req] === undefined || obj[req] === null) {
      return `工具 ${toolName} 缺少必填参数: ${req}`;
    }
  }

  for (const [key, val] of Object.entries(obj)) {
    const propSchema = schema.properties?.[key];
    if (!propSchema) {
      // 未知字段直接忽略（保持对 LLM 幻觉字段的宽容）
      continue;
    }
    const actual = Array.isArray(val) ? 'array' : typeof val;
    if (propSchema.type === 'array') {
      if (!Array.isArray(val)) return `工具 ${toolName} 参数 ${key} 必须是数组，实际: ${actual}`;
      const itemType = propSchema.items?.type;
      if (itemType) {
        for (const [idx, item] of val.entries()) {
          if (typeof item !== itemType) {
            return `工具 ${toolName} 参数 ${key}[${idx}] 类型应为 ${itemType}，实际: ${typeof item}`;
          }
          if (itemType === 'string' && typeof item === 'string' && item.length > 256) {
            return `工具 ${toolName} 参数 ${key}[${idx}] 字符串超长 (${item.length} > 256)`;
          }
        }
      }
      continue;
    }
    if (propSchema.type === 'string' && typeof val !== 'string') {
      return `工具 ${toolName} 参数 ${key} 类型应为 string，实际: ${actual}`;
    }
    if (propSchema.type === 'number' && typeof val !== 'number') {
      return `工具 ${toolName} 参数 ${key} 类型应为 number，实际: ${actual}`;
    }
    if (propSchema.type === 'string' && typeof val === 'string' && val.length > 512) {
      return `工具 ${toolName} 参数 ${key} 字符串超长 (${val.length} > 512)`;
    }
  }

  return null;
}

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

    // R3：执行前参数校验
    const validationError = validateToolArgs(toolName, args);
    if (validationError) {
      logger.warn('ToolRouter', '工具参数校验失败，拒绝执行', {
        tool: toolName,
        args,
        reason: validationError,
      });
      return { error: validationError, hint: '请检查工具参数类型/必填项，参考 TOOLS_DEFINITION' };
    }

    try {
      let result: any;
      switch (toolName) {
        case 'queryPcs':
          result = await queryPcs(args);
          break;
        case 'getHomePage':
          result = await getHomePage();
          break;
        case 'getBmsYx':
          result = await getBmsYx();
          break;
        case 'getPcsYc':
          result = await getPcsYc();
          break;
        case 'getPcsYx':
          result = await getPcsYx();
          break;
        case 'getDcdcYc':
          result = await getDcdcYc(args);
          break;
        case 'getDcdcYx':
          result = await getDcdcYx(args);
          break;
        case 'getMeterYc':
          result = await getMeterYc(args);
          break;
        case 'getMeterYx':
          result = await getMeterYx(args);
          break;
        case 'getRealTimeAlarms':
          result = await getRealTimeAlarms();
          break;
        case 'getHistoryAlarms':
          result = await getHistoryAlarms(args);
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

// 导出以便单元测试
export { validateToolArgs };
