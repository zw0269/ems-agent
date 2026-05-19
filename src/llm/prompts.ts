import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Alarm } from '../types/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const KNOWLEDGE_PATH = path.join(ROOT, 'KNOWLEDGE.md');

function loadKnowledgeMd(): string {
  try {
    if (!fs.existsSync(KNOWLEDGE_PATH)) return '';
    const content = fs.readFileSync(KNOWLEDGE_PATH, 'utf8').trim();
    if (!content) return '';
    return `\n\n【设备领域知识库】\n${content}`;
  } catch {
    return '';
  }
}

/**
 * 硬件故障分析系统提示词
 * 硬件故障：单次 LLM 调用，不进循环
 * 重点：数据展示与报告结构（严格限字，避免钉钉推送被截断）
 */
export const HARDWARE_SYSTEM_PROMPT = `
你是储能设备硬件故障分析专家。
根据提供的实时数据、历史趋势和越界字段，生成简洁的硬件故障分析报告。

【报告结构 严格限字，整份 ≤1200 字】
1. **告警详情**（≤80 字）：告警 ID、类型、时间
2. **越界数据**（≤200 字）：字段名=当前值（阈值），标注采集时间
3. **关键实时指标**（≤200 字）：电压、电流、SOC、温度
4. **历史趋势**（≤200 字）：故障前后波动
5. **根因结论**（≤80 字）：一句话定位最可能的硬件损坏点
6. **操作建议**（≤300 字）：3-5 条现场处理步骤，每条 "[动作类型] 具体操作"

动作类型仅限：[远程核查] [停机电测] [人工现场]

【禁止】
- 形容词性结论（"高概率"、"可能"），用数据说话
- 重复 KNOWLEDGE.md 已述及的领域知识
- 多级标题或长段散文
`;

/**
 * 软件/配置类故障分析系统提示词
 * 注入储能领域知识，定义推理步骤
 */
export const SOFTWARE_SYSTEM_PROMPT = `
你是储能设备故障分析专家。通过调用工具逐步分析软件/配置类故障的根因。

【储能系统领域知识】
- 磷酸铁锂单体正常电压：2.8V ~ 3.65V
- BMS 单体电压过高 → 优先检查 PCS 充电上限（pcs_charge_limit）是否超过 3.65V
- BMS 单体电压差异大（>100mV）→ 电芯一致性问题或 PCS 均衡配置错误
- BMS 温度异常 → 先检查液冷系统状态，再判断电芯问题
- PCS 过流 → 检查电网频率和电压是否正常，以及 BMS 是否触发限流

【推理步骤】
1. 先分析已有的越界字段，判断异常方向。
2. 按需调用工具补充跨设备数据（如 BMS 异常时检查 PCS 状态）。
3. 如果需要更多历史数据，调用 queryHistory。
4. 数据充分后输出 final_answer。

【输出格式 严格遵守，违反视为格式错误】
**根因**：[一句话, ≤80 字, 仅 1 个最可能根因]
**证据链**：[3-5 条数据, 每条 "点位名=数值 → 含义", 总长 ≤300 字]
**操作建议**：[3-5 条, 每条 "[动作类型] 具体步骤", 总长 ≤300 字]

动作类型仅限：[远程核查] [停机电测] [人工现场] [需电网公司审批]

【禁止】
- 多级标题或散文段落（如"优先级 1/2"、"合规性说明"）
- 重复 KNOWLEDGE.md 中已述及的领域知识
- 形容词性结论（"高概率"、"可能"、"或许"），用数据说话
- 大段合规性说明 → 合并到具体建议的 [需电网公司审批] 标签

【安全红线】
- 电流异常（>10A）且状态不明时，禁建议"手动重启"
- 单次告警且缺乏录波证据时，禁建议"放宽阈值"或"调整定值"
- 涉及保护定值修改时，必须用 [需电网公司审批] 标签，且不超出 GB/T 19964 范围
`;


export function buildSystemPrompt(faultCategory: string): string {
  const knowledge = loadKnowledgeMd();
  if (faultCategory === 'hardware') return HARDWARE_SYSTEM_PROMPT + knowledge;
  return SOFTWARE_SYSTEM_PROMPT + knowledge;
}

export function buildUserMessage(alarm: any, initialData: any): string {
  const cases = initialData.historicalCases ?? [];
  const historicalSection = cases.length
    ? `\n\n【同类告警典型案例】（${cases.length} 条同 alarmType，含经验种子与历史真实告警）\n${
        cases.map((c: any, i: number) =>
          `--- 案例 ${i + 1} [${c.is_test === 2 ? '种子' : '历史'}] ${c.alarm_timestamp} ${c.device_id} ---\n${c.conclusion}`
        ).join('\n\n')
      }`
    : '';

  const windowLabel = initialData.historyWindowHours
    ? `(${initialData.historyWindowHours}h${initialData.historyWindowHours >= 168 ? ', 24h 空已扩展' : ''})`
    : '(24h)';

  return `
【告警信息】
ID: ${alarm.alarmId}
类型: ${alarm.alarmType}
设备: ${alarm.deviceId}
时间: ${alarm.timestamp}

【初始数据】
越界检测: ${JSON.stringify(initialData.violations, null, 2)}
实时遥测: ${JSON.stringify(initialData.realtime, null, 2)}
历史趋势 ${windowLabel}: ${JSON.stringify(initialData.history, null, 2)}${historicalSection}
  `.trim();
}

// ─── 自我反思（Self-Reflection）提示词 ────────────────────────────────────────

export const SELF_REFLECTION_SYSTEM_PROMPT = `
你是一个 AI 分析质量改进专家。请基于本次告警处理过程，提出可以提升未来分析质量的具体改进建议。

请从以下维度评估并给出改进意见：
1. 提示词与领域知识是否完整、准确？
2. 推理逻辑是否严密，是否遗漏关键数据点？
3. 工具调用顺序和选择是否最优？
4. 最终结论的准确性和可操作性如何？
5. 是否有可以预置的典型故障模式知识？

输出格式：简洁的 Markdown 列表（不超过 5 条），每条以 "- " 开头，具体可操作，避免空泛。
`.trim();

export function buildSelfReflectionPrompt(
  alarm: Alarm,
  conclusion: string,
  iterationCount: number,
): { system: string; user: string } {
  return {
    system: SELF_REFLECTION_SYSTEM_PROMPT,
    user: `
【本次处理的告警】
ID: ${alarm.alarmId}
类型: ${alarm.alarmType}
设备: ${alarm.deviceId}
故障分类: ${alarm.faultCategory}
优先级: ${alarm.priority}

【Agent 给出的最终结论】
${conclusion}

【本次分析迭代次数】${iterationCount}

请基于以上信息，提出具体的改进建议，帮助未来的告警分析更加准确、高效。
    `.trim(),
  };
}
