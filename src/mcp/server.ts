/**
 * EMS Agent MCP Server
 *
 * 对标 Anthropic Claude Desktop / Cursor 的 MCP 接入：把 EMS 后端的 11 个工具
 * 通过 Model Context Protocol 协议暴露，让任意支持 MCP 的客户端（Claude Desktop /
 * Cursor / Continue / Cline 等）都能直接调用储能站的实时数据。
 *
 * 不替代主项目的 OpenAI function calling 路径，作为附加生态能力存在。
 *
 * 启动方式（stdio 模式，被 client 直接 spawn）：
 *   npx tsx scripts/mcp-server.ts
 */
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getHomePage, getBmsYx, getPcsYc, getPcsYx, queryPcs,
  getDcdcYc, getDcdcYx, getMeterYc, getMeterYx,
  getRealTimeAlarms, getHistoryAlarms,
} from '../tools/queryEms.js';

const SERVER_NAME = 'ems-agent';
const SERVER_VERSION = '1.0.0';

export function createEmsAgentMcpServer(): McpServer {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // 工具结果统一封装为 MCP content 块
  const wrap = (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  });

  mcp.registerTool('getHomePage', {
    description: '获取系统概览：电池 SOC、PCS/BMS/电网整体运行参数、系统模式、告警计数',
    inputSchema: {},
  }, async () => wrap(await getHomePage()));

  mcp.registerTool('getBmsYx', {
    description: '获取 BMS 所有告警/故障遥信状态（value=true 表示触发），用于定位 BMS 硬件故障根因',
    inputSchema: {},
  }, async () => wrap(await getBmsYx()));

  mcp.registerTool('getPcsYc', {
    description: '获取 PCS 实时遥测值（电压/电流/功率/温度/充放电量），用于分析 PCS 运行参数异常',
    inputSchema: {},
  }, async () => wrap(await getPcsYc()));

  mcp.registerTool('getPcsYx', {
    description: '获取 PCS 运行/故障/告警遥信状态（sort=1 且 value=true 为故障），用于判断 PCS 异常根因',
    inputSchema: {},
  }, async () => wrap(await getPcsYx()));

  mcp.registerTool('queryPcs', {
    description: '获取 PCS 综合数据（遥测+遥信合并），可按 fields 过滤关注字段',
    inputSchema: {
      fields: z.array(z.string()).optional().describe('按 key 过滤返回字段，不传则返回全部'),
    },
  }, async ({ fields }) => wrap(await queryPcs({ ...(fields ? { fields } : {}) })));

  mcp.registerTool('getDcdcYc', {
    description: '获取指定 DCDC 变换器实时遥测（功率/电压/温度），index=0 为 DCDC1，index=1 为 DCDC2',
    inputSchema: {
      index: z.number().int().min(0).max(1).describe('0=DCDC1，1=DCDC2'),
    },
  }, async ({ index }) => wrap(await getDcdcYc({ index })));

  mcp.registerTool('getDcdcYx', {
    description: '获取指定 DCDC 故障代码和通讯诊断状态，故障代码非 0 表示异常',
    inputSchema: {
      index: z.number().int().min(0).max(1).describe('0=DCDC1，1=DCDC2'),
    },
  }, async ({ index }) => wrap(await getDcdcYx({ index })));

  mcp.registerTool('getMeterYc', {
    description: '获取指定电表实时遥测（三相电压/电流/功率/电能），index=0 为电表1，index=1 为电表2',
    inputSchema: {
      index: z.number().int().min(0).max(1).describe('0=电表1，1=电表2'),
    },
  }, async ({ index }) => wrap(await getMeterYc({ index })));

  mcp.registerTool('getMeterYx', {
    description: '获取指定电表通讯状态，通讯异常时 value=true',
    inputSchema: {
      index: z.number().int().min(0).max(1).describe('0=电表1，1=电表2'),
    },
  }, async ({ index }) => wrap(await getMeterYx({ index })));

  mcp.registerTool('getRealTimeAlarms', {
    description: '获取当前所有活跃告警列表（未恢复），空列表表示无告警',
    inputSchema: {},
  }, async () => wrap(await getRealTimeAlarms()));

  mcp.registerTool('getHistoryAlarms', {
    description: '查询历史告警记录（含恢复时间），用于分析告警趋势和历史规律',
    inputSchema: {
      startTime: z.string().optional().describe('开始时间，格式 YYYY-MM-DD HH:mm:ss'),
      endTime:   z.string().optional().describe('结束时间，格式 YYYY-MM-DD HH:mm:ss'),
    },
  }, async ({ startTime, endTime }) => {
    const params: { startTime?: string; endTime?: string } = {};
    if (startTime !== undefined) params.startTime = startTime;
    if (endTime !== undefined) params.endTime = endTime;
    return wrap(await getHistoryAlarms(params));
  });

  return mcp;
}

export async function runStdioServer(): Promise<void> {
  const mcp = createEmsAgentMcpServer();
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // 注：stdio 模式下 stdout 是协议通道，日志只能走 stderr
  process.stderr.write(`[mcp-server] ${SERVER_NAME} v${SERVER_VERSION} listening on stdio (11 tools registered)\n`);
}
