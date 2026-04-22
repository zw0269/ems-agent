/**
 * R4 聚类反哺 self-improvement（纯 LLM 版，不依赖 embedding）
 *
 * 作用：把 self_improvements 表里近 30 天的原始 AI 反思建议，
 *       用配置好的主 LLM 一次性做主题聚类，再对每个聚类归纳成一条"D/I 规则"，
 *       追加到 self-improvement.md 的增量案例区。
 *
 * 说明：LLM provider / model / key 全部沿用 .env 里的 LLM_PROVIDER / LLM_API_KEY / LLM_MODEL，
 *       不会单独读任何外部 API Key，也不会调用其他模型。
 *
 * 运行：npm run cluster-reflections
 *       可调 env：
 *         - CLUSTER_LOOKBACK_DAYS  回溯天数，默认 30
 *         - CLUSTER_MAX_ITEMS      单次聚类处理的反思建议上限，默认 100（防超上下文）
 *         - CLUSTER_MIN_SIZE       最小聚类成员数，默认 2（孤立项丢弃）
 *
 * 注意：只追加到 self-improvement.md 末尾，不覆盖高频缺陷表区。
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../src/db/database.js';
import { LLMClient } from '../src/llm/client.js';
import { ContextManager } from '../src/runtime/contextManager.js';
import { logger } from '../src/utils/logger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_FILE = path.join(ROOT, 'self-improvement.md');

const LOOKBACK_DAYS    = parseInt(process.env['CLUSTER_LOOKBACK_DAYS'] ?? '30',  10);
const MAX_ITEMS        = parseInt(process.env['CLUSTER_MAX_ITEMS']    ?? '100', 10);
const MIN_CLUSTER_SIZE = parseInt(process.env['CLUSTER_MIN_SIZE']     ?? '2',   10);

interface Suggestion {
  id: number;
  alarmId: string;
  text: string;
}

function fetchSuggestions(): Suggestion[] {
  return getDb().prepare(`
    SELECT id, alarm_id AS alarmId, suggestion_text AS text
    FROM self_improvements
    WHERE created_at >= datetime('now', '-${LOOKBACK_DAYS} days')
    ORDER BY created_at DESC
    LIMIT ${MAX_ITEMS}
  `).all() as Suggestion[];
}

const CLUSTER_SYSTEM = `你是储能运维经验归纳专家。你会收到 N 条 AI 反思建议，每条前面带 id。
请按语义主题分组，输出严格 JSON（不要 Markdown、不要前后缀、不要 code fence）：
{"clusters":[{"theme":"<主题一句话>","ids":[<整数 id 列表>]}, ...]}

要求：
- 每个聚类至少 ${MIN_CLUSTER_SIZE} 条；单条孤立建议不要成簇
- 不同主题不得合并
- id 必须来自输入，不得编造
- theme 控制在 30 字以内，中文`;

const SUMMARY_SYSTEM = `你是储能运维经验归纳专家。你会收到来自同一聚类的原始 AI 反思建议。
请归纳为一条面向未来告警分析的规则，输出单一 Markdown 列表项，格式：
- **规则名**：[一句话标题]
  - **Why**：[该规则为什么重要，指向哪类案例]
  - **How to apply**：[在分析的哪个阶段、如何应用]

总长度不超过 300 字，不要额外前后缀。`;

async function clusterAllAtOnce(llm: LLMClient, items: Suggestion[]): Promise<Array<{ theme: string; ids: number[] }>> {
  const ctx = new ContextManager();
  ctx.addSystem(CLUSTER_SYSTEM);
  const payload = items.map(s => `id=${s.id}: ${s.text.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n\n');
  ctx.addUser(payload);

  const resp = await llm.call(ctx.get(), undefined, { alarmId: `cluster-all-${Date.now()}`, callIndex: 0 });
  const raw = (resp.text ?? '').trim();
  // 容错：LLM 偶尔会加 code fence
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');

  try {
    const parsed = JSON.parse(jsonStr) as { clusters?: Array<{ theme?: unknown; ids?: unknown }> };
    if (!Array.isArray(parsed.clusters)) return [];
    const validIds = new Set(items.map(s => s.id));
    return parsed.clusters
      .filter(c => Array.isArray(c.ids) && typeof c.theme === 'string')
      .map(c => ({
        theme: String(c.theme),
        ids: (c.ids as unknown[])
          .map(x => typeof x === 'number' ? x : parseInt(String(x), 10))
          .filter(n => Number.isInteger(n) && validIds.has(n)),
      }))
      .filter(c => c.ids.length >= MIN_CLUSTER_SIZE);
  } catch (err) {
    logger.error('ClusterRefl', 'LLM 返回非 JSON，聚类失败', {
      error: (err as Error).message,
      preview: raw.slice(0, 300),
    });
    return [];
  }
}

async function summarizeCluster(llm: LLMClient, theme: string, reps: Suggestion[]): Promise<string> {
  const ctx = new ContextManager();
  ctx.addSystem(SUMMARY_SYSTEM);
  ctx.addUser(`【聚类主题】${theme}\n\n` + reps.map((s, i) => `【样本 ${i + 1}】\n${s.text}`).join('\n\n'));
  const resp = await llm.call(ctx.get(), undefined, { alarmId: `cluster-sum-${Date.now()}`, callIndex: 0 });
  return (resp.text ?? '').trim();
}

async function main() {
  const llm = new LLMClient();
  logger.info('ClusterRefl', `开始聚类（lookback=${LOOKBACK_DAYS}天, max=${MAX_ITEMS}, min_size=${MIN_CLUSTER_SIZE}）`);

  const items = fetchSuggestions();
  logger.info('ClusterRefl', `拉取到 ${items.length} 条候选建议`);
  if (items.length < MIN_CLUSTER_SIZE) {
    logger.info('ClusterRefl', `样本不足 ${MIN_CLUSTER_SIZE} 条，跳过本次聚类`);
    return;
  }

  const clusters = await clusterAllAtOnce(llm, items);
  logger.info('ClusterRefl', `形成 ${clusters.length} 个有效聚类`, { sizes: clusters.map(c => c.ids.length) });
  if (clusters.length === 0) {
    logger.info('ClusterRefl', '无有效聚类，结束');
    return;
  }

  const idMap = new Map(items.map(s => [s.id, s]));
  const lines: string[] = [
    '',
    `<!-- 自动聚类追加：${new Date().toISOString()} -->`,
    `<!-- 参数：lookback=${LOOKBACK_DAYS}天, 候选=${items.length}, 聚类=${clusters.length}, 模型=主LLM -->`,
    '',
  ];

  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]!;
    const members = c.ids.map(id => idMap.get(id)).filter(Boolean) as Suggestion[];
    if (members.length < MIN_CLUSTER_SIZE) continue;

    const reps = members.slice(0, 3);
    logger.info('ClusterRefl', `归纳聚类 ${i + 1}/${clusters.length}`, { size: members.length, theme: c.theme });
    const summary = await summarizeCluster(llm, c.theme, reps);

    lines.push(`### 增量规则 ${i + 1}：${c.theme}`);
    lines.push(`<sub>聚合 ${members.length} 条原始建议，覆盖 alarmId：${members.map(m => m.alarmId).slice(0, 8).join(', ')}${members.length > 8 ? ' ...' : ''}</sub>`);
    lines.push('');
    lines.push(summary);
    lines.push('');
  }

  fs.appendFileSync(TARGET_FILE, lines.join('\n'), 'utf8');
  logger.info('ClusterRefl', `已追加 ${clusters.length} 条聚类规则到 self-improvement.md`);
}

main().catch(err => {
  console.error('聚类脚本失败:', err);
  process.exit(1);
});
