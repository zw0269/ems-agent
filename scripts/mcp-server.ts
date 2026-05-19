/**
 * MCP Server 启动入口（stdio 模式）
 *
 * 使用：
 *   配置到 Claude Desktop 的 mcp-config.json：
 *   {
 *     "mcpServers": {
 *       "ems-agent": {
 *         "command": "npx",
 *         "args": ["tsx", "/Users/zw/work/project_test/ems-agent/scripts/mcp-server.ts"],
 *         "env": { "EMS_BASE_URL": "http://192.168.1.100:8080" }
 *       }
 *     }
 *   }
 *
 *   或独立调试：
 *     npx tsx scripts/mcp-server.ts
 */
import { runStdioServer } from '../src/mcp/server.js';

runStdioServer().catch(err => {
  process.stderr.write(`[mcp-server] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
