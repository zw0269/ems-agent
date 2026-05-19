/**
 * 结论解析器：从 LLM 的 markdown 输出中提取结构化元数据
 *
 * 设计原则：
 * - 容错优先：解析失败不抛错，返回 confidence=-1（"未知"）
 * - 不依赖 LLM 输出 JSON（更鲁棒，markdown 才是 LLM 强项）
 * - 仅做提取，不修改原文（钉钉/邮件仍发完整 markdown）
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
export type RiskLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface ParsedConclusion {
  confidence: number;           // 0-100, -1 表示未解析到
  severity: Severity;
  rootCause: string;            // 原文一句话
  actionCount: number;          // 操作建议条数
  highRiskActions: number;      // 高风险操作条数
  raw: string;
}

/**
 * 解析 LLM 输出的 conclusion
 */
export function parseConclusion(conclusion: string): ParsedConclusion {
  const result: ParsedConclusion = {
    confidence: -1,
    severity: 'unknown',
    rootCause: '',
    actionCount: 0,
    highRiskActions: 0,
    raw: conclusion,
  };

  if (!conclusion || typeof conclusion !== 'string') return result;

  // 置信度：**置信度**：85  或  置信度: 85%
  const confMatch = conclusion.match(/\*?\*?置信度\*?\*?\s*[:：]\s*\[?(\d{1,3})\]?/);
  if (confMatch && confMatch[1]) {
    const n = parseInt(confMatch[1], 10);
    if (n >= 0 && n <= 100) result.confidence = n;
  }

  // 严重度
  const sevMatch = conclusion.match(/\*?\*?严重度\*?\*?\s*[:：]\s*\[?(critical|high|medium|low)\]?/i);
  if (sevMatch && sevMatch[1]) {
    result.severity = sevMatch[1].toLowerCase() as Severity;
  }

  // 根因（保持一句话）
  const rcMatch = conclusion.match(
    /\*\*根因\*\*\s*[:：]?\s*\[?([\s\S]*?)\]?(?=\n\s*\*\*(?:证据链|操作建议)|$)/,
  );
  if (rcMatch && rcMatch[1]) {
    result.rootCause = rcMatch[1].trim().slice(0, 200);
  }

  // 操作建议条数 + 高风险条数
  // 仅匹配真正的 markdown 列表项 "- " / "* " / "1. "，避免把 **操作建议** 这种加粗标题也算入
  const actionsBlock = conclusion.match(/\*\*操作建议\*\*[\s\S]*$/)?.[0] ?? '';
  const actionLines = actionsBlock.split('\n').filter(l => /^\s*(?:[-*+]\s|\d+\.\s)/.test(l));
  result.actionCount = actionLines.length;
  result.highRiskActions = actionLines.filter(l => /风险\s*[:：]\s*high/i.test(l)).length;

  return result;
}

/**
 * 把置信度转为短徽章（用于钉钉/Web 面板标题前缀）
 * 钉钉 markdown 不支持 inline 颜色，用中文档位区分
 */
export function confidenceBadge(confidence: number): string {
  if (confidence < 0) return '[置信度: 未知]';
  const level = confidence >= 80 ? '高' : confidence >= 60 ? '中' : '低';
  return `[置信度${level} ${confidence}%]`;
}

/**
 * 严重度短标
 */
export function severityBadge(severity: Severity): string {
  const map: Record<Severity, string> = {
    critical: '[严重]',
    high: '[高]',
    medium: '[中]',
    low: '[低]',
    unknown: '',
  };
  return map[severity] ?? '';
}

/**
 * Web 面板用：把置信度映射为 CSS 颜色（与 statusServer.ts 的 token 配套）
 */
export function confidenceCssColor(confidence: number): string {
  if (confidence < 0) return '#888';
  if (confidence >= 80) return '#3a7d44'; // 绿
  if (confidence >= 60) return '#c08000'; // 黄
  return '#b03030';                        // 红
}
