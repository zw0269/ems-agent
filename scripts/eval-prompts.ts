/**
 * Prompt 回归测试 / 评估集（LangSmith-like 雏形）
 *
 * 用途：改 prompt 前后跑这个脚本，对比准确率/置信度分布，避免 prompt 改动靠"感觉"。
 *
 * 数据：data/eval-cases/*.json
 * 评估：基于 expected.rootCausePattern 等字段做轻量级 LLM-as-Judge / 正则匹配。
 *
 * 运行：npx tsx scripts/eval-prompts.ts
 *      可调 env：
 *        EVAL_CASE_DIR    覆盖 cases 目录（默认 data/eval-cases）
 *        EVAL_VERBOSE=1   打印每个 case 的完整 conclusion
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentLoop } from '../src/runtime/agentLoop.js';
import { parseConclusion } from '../src/utils/conclusionParser.js';
import type { Alarm } from '../src/types/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASE_DIR = process.env['EVAL_CASE_DIR'] ?? path.join(ROOT, 'data/eval-cases');
const VERBOSE = process.env['EVAL_VERBOSE'] === '1';

interface EvalCase {
  _meta: { id: string; source: string; tags: string[]; createdAt: string };
  input: {
    alarmId: string;
    alarmType: string;
    deviceId: string;
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    faultCategory: 'software' | 'hardware';
    timestamp: string;
    realtime: Record<string, unknown>;
    history: unknown[];
    violations: unknown[];
  };
  expected: {
    rootCausePattern: string;
    minConfidence: number;
    severity: string[];
    mustIncludeActions: string[];
    mustNotInclude: string[];
  };
}

interface EvalResult {
  caseId: string;
  pass: boolean;
  reasons: string[];
  confidence: number;
  severity: string;
  conclusionPreview: string;
}

function loadCases(): EvalCase[] {
  if (!fs.existsSync(CASE_DIR)) {
    console.error(`[Eval] 用例目录不存在: ${CASE_DIR}`);
    return [];
  }
  const files = fs.readdirSync(CASE_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(CASE_DIR, f), 'utf8')) as EvalCase);
}

async function runCase(caseData: EvalCase, agent: AgentLoop): Promise<EvalResult> {
  const { input, expected } = caseData;
  const alarm: Alarm = {
    alarmId: input.alarmId,
    alarmType: input.alarmType,
    deviceId: input.deviceId,
    priority: input.priority,
    faultCategory: input.faultCategory,
    timestamp: input.timestamp,
  };

  let conclusion: string;
  if (input.faultCategory === 'hardware') {
    conclusion = await agent.runOnce(alarm, input.realtime, input.history, input.violations as never);
  } else {
    conclusion = await agent.run(alarm, {
      realtime: input.realtime,
      history: input.history as object,
      violations: input.violations as object[],
    });
  }

  const parsed = parseConclusion(conclusion);
  const reasons: string[] = [];

  // 检查根因关键词
  if (!new RegExp(expected.rootCausePattern).test(conclusion)) {
    reasons.push(`根因未匹配 /${expected.rootCausePattern}/`);
  }

  // 检查置信度
  if (parsed.confidence < expected.minConfidence) {
    reasons.push(`置信度 ${parsed.confidence} < ${expected.minConfidence}`);
  }

  // 检查严重度
  if (!expected.severity.includes(parsed.severity)) {
    reasons.push(`严重度 '${parsed.severity}' 不在期望集 [${expected.severity.join(',')}]`);
  }

  // 必含动作类型
  for (const a of expected.mustIncludeActions) {
    if (!conclusion.includes(a)) reasons.push(`缺少必须包含的动作 '${a}'`);
  }

  // 禁含
  for (const m of expected.mustNotInclude) {
    if (conclusion.includes(m)) reasons.push(`命中禁词 '${m}'`);
  }

  return {
    caseId: caseData._meta.id,
    pass: reasons.length === 0,
    reasons,
    confidence: parsed.confidence,
    severity: parsed.severity,
    conclusionPreview: conclusion.replace(/\n/g, ' ').slice(0, 120),
  };
}

async function main() {
  const cases = loadCases();
  if (!cases.length) {
    console.error('[Eval] 无可用用例，退出');
    process.exit(1);
  }

  console.log(`[Eval] 加载 ${cases.length} 个用例，开始执行...\n`);
  const agent = new AgentLoop();
  const results: EvalResult[] = [];

  for (const c of cases) {
    process.stdout.write(`[Eval] 执行 ${c._meta.id} (${c._meta.tags.join(',')}) ... `);
    try {
      const r = await runCase(c, agent);
      results.push(r);
      console.log(r.pass ? 'PASS' : `FAIL (${r.reasons.join('; ')})`);
      if (VERBOSE) console.log(`  conclusion: ${r.conclusionPreview}...`);
    } catch (err: unknown) {
      console.log(`ERROR: ${(err as Error).message}`);
      results.push({
        caseId: c._meta.id,
        pass: false,
        reasons: [`异常: ${(err as Error).message}`],
        confidence: -1,
        severity: 'unknown',
        conclusionPreview: '',
      });
    }
  }

  const passed = results.filter(r => r.pass).length;
  const confidences = results.map(r => r.confidence).filter(c => c >= 0);
  const avgConf = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : -1;

  console.log('\n══════════════════════════════════════════════════');
  console.log(`[Eval] 通过率: ${passed}/${results.length}  (${((passed / results.length) * 100).toFixed(1)}%)`);
  console.log(`[Eval] 平均置信度: ${avgConf < 0 ? '无' : avgConf.toFixed(1)}%`);
  console.log('══════════════════════════════════════════════════');

  if (passed < results.length) {
    console.log('\n失败用例明细:');
    for (const r of results.filter(x => !x.pass)) {
      console.log(`  - ${r.caseId}: ${r.reasons.join('; ')}`);
    }
    process.exit(1);
  }
}

main().catch(err => {
  console.error('[Eval] 主流程异常:', err);
  process.exit(1);
});
