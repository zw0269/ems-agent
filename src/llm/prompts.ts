import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Alarm } from '../types/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const SELF_IMPROVEMENT_PATH = path.join(ROOT, 'self-improvement.md');

/**
 * 读取 self-improvement.md，每次调用时重新读取（热加载，无需重启）
 */
function loadSelfImprovementMd(): string {
  try {
    if (!fs.existsSync(SELF_IMPROVEMENT_PATH)) return '';
    const content = fs.readFileSync(SELF_IMPROVEMENT_PATH, 'utf8').trim();
    // 去掉只有标题注释的空文件
    const lines = content.split('\n').filter(l => !l.startsWith('#') && l.trim() !== '---' && l.trim() !== '');
    if (!lines.length) return '';
    return `\n\n【历史经验与自我改进积累】\n${content}`;
  } catch {
    return '';
  }
}

/**
 * 硬件故障分析系统提示词
 * 硬件故障：单次 LLM 调用，不进循环
 * 重点：数据展示与报告结构
 */
export const HARDWARE_SYSTEM_PROMPT = `
你是储能设备硬件故障分析专家。
你的任务是根据提供的实时数据、历史趋势和越界字段，生成一份专业的硬件故障分析报告。

【报告结构要求】
1. 故障告警详情：简述告警 ID、类型、发生时间。
2. 越界数据（标注时间）：列出所有触发阈值的字段、当前值、阈值。
3. 实时数据摘要（标注采集时间）：提取关键核心指标（电压、电流、SOC 等）。
4. 历史趋势分析：分析故障前后的数据波动情况。
5. 根因结论：基于数据给出的最可能的硬件损坏或连接异常点。
6. 操作建议：现场处理步骤（不含远程控制指令）。

【语言风格】
简洁专业，数据优先，不废话。
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

【输出格式（final_answer）】
根因：[一句话总结]
证据链：[具体数据支撑，包含点位名和数值]
操作建议：[具体配置调整或排查步骤]
`;

export function buildSystemPrompt(faultCategory: string): string {
  const improvement = loadSelfImprovementMd();
  if (faultCategory === 'hardware') {
    return HARDWARE_SYSTEM_PROMPT + improvement;
  }
  return SOFTWARE_SYSTEM_PROMPT + improvement;
}

export function buildUserMessage(alarm: any, initialData: any): string {
  return `
【告警信息】
ID: ${alarm.alarmId}
类型: ${alarm.alarmType}
设备: ${alarm.deviceId}
时间: ${alarm.timestamp}

【初始数据】
越界检测: ${JSON.stringify(initialData.violations, null, 2)}
实时遥测: ${JSON.stringify(initialData.realtime, null, 2)}
历史趋势 (24h): ${JSON.stringify(initialData.history, null, 2)}
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
