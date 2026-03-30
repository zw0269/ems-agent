import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 日志目录：项目根目录 logs/
const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const LOG_DIR = path.join(ROOT, 'logs');

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/** 当天 AI 操作日志路径：logs/ai-ops-YYYY-MM-DD.log */
function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `ai-ops-${date}.log`);
}

function padModule(mod: string, width = 14): string {
  return mod.length >= width ? mod.slice(0, width) : mod + ' '.repeat(width - mod.length);
}

/**
 * 写入一条日志
 * 格式：2026-03-30T14:30:00.000Z [INFO ] [Module        ] message | {"key":"val"}
 */
function write(level: LogLevel, module: string, message: string, context?: Record<string, unknown>) {
  ensureLogDir();

  const ts   = new Date().toISOString();
  const lvl  = level.padEnd(5);
  const mod  = padModule(module);
  const ctx  = context ? ' | ' + JSON.stringify(context) : '';
  const line = `${ts} [${lvl}] [${mod}] ${message}${ctx}\n`;

  try {
    fs.appendFileSync(getLogFile(), line, 'utf8');
  } catch {
    // 写入失败不能影响主流程
  }

  // 同步输出到控制台（保留原有可观测性）
  if (level === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

/**
 * AI 操作日志记录器
 *
 * 日志文件：logs/ai-ops-YYYY-MM-DD.log（每天自动新建）
 *
 * 用法：
 *   logger.info('LLMClient', 'API 调用成功', { model: 'gpt-4o', durationMs: 1200 });
 *   logger.warn('AgentLoop', '重试第 2 次', { alarmId: 'A001' });
 *   logger.error('ToolRouter', '工具执行失败', { tool: 'queryBms', error: '...' });
 */
export const logger = {
  info (module: string, message: string, context?: Record<string, unknown>) {
    write('INFO',  module, message, context);
  },
  warn (module: string, message: string, context?: Record<string, unknown>) {
    write('WARN',  module, message, context);
  },
  error(module: string, message: string, context?: Record<string, unknown>) {
    write('ERROR', module, message, context);
  },
};
