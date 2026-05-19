import { getDb } from '../db/database.js';
import { parseConclusion } from '../utils/conclusionParser.js';
import { logger } from '../utils/logger.js';

/**
 * 健康度评分（System Health Score）
 *
 * 对标 Google SRE SLO + Datadog Service Health Score + Stem Athena 站级评分。
 *
 * 算法 v1：
 *   score = 100 - min(99, Σ severity_weight × recency_decay)
 *
 *   - severity_weight: critical=25, high=12, medium=5, low=1, unknown=3
 *   - recency_decay: 刚发生 1.0，24h 前 0.1，线性
 *   - cap 99（保留底分 1 表示"始终能恢复"）
 *
 * 严重度推断优先级（按可信度）：
 *   1. conclusion 里 LLM 自评的 **严重度** 标签
 *   2. priority 倒推（P3→critical, P2→high, P1→medium, P0→low）
 *
 * 不存快照表：30 天内 alarm_records 数据量小，每次实时算可接受。
 */

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 12,
  medium: 5,
  low: 1,
  unknown: 3,
};

const PRIORITY_TO_SEVERITY: Record<string, Severity> = {
  P3: 'critical',
  P2: 'high',
  P1: 'medium',
  P0: 'low',
};

interface AlarmRow {
  conclusion: string | null;
  priority: string;
  started_at: string;
  hours_ago: number;
}

function inferSeverity(row: { conclusion: string | null; priority: string }): Severity {
  // 优先用 LLM 自评
  if (row.conclusion) {
    const sev = parseConclusion(row.conclusion).severity;
    if (sev !== 'unknown') return sev;
  }
  // 回退：priority → severity
  return PRIORITY_TO_SEVERITY[row.priority] ?? 'unknown';
}

function recencyDecay(hoursAgo: number): number {
  // 24h 前 0.1，刚发生 1.0；超过 24h clamp 到 0.1
  const decay = Math.max(0.1, 1 - hoursAgo / 24);
  return decay;
}

/**
 * 计算当前健康度（基于近 24h 真实告警，排除 is_test=2 经验种子）
 */
export function computeCurrentScore(): {
  score: number;
  level: 'excellent' | 'good' | 'warning' | 'critical';
  contributing: Array<{ severity: Severity; count: number; impact: number }>;
} {
  try {
    const rows = getDb().prepare(`
      SELECT
        conclusion,
        priority,
        started_at,
        (julianday('now') - julianday(datetime(started_at, '-8 hours'))) * 24 AS hours_ago
      FROM alarm_records
      WHERE started_at >= datetime('now', '-24 hours')
        AND is_test != 2
        AND status != 'processing'
      ORDER BY started_at DESC
    `).all() as AlarmRow[];

    let totalImpact = 0;
    const breakdown: Record<Severity, { count: number; impact: number }> = {
      critical: { count: 0, impact: 0 },
      high:     { count: 0, impact: 0 },
      medium:   { count: 0, impact: 0 },
      low:      { count: 0, impact: 0 },
      unknown:  { count: 0, impact: 0 },
    };

    for (const r of rows) {
      const sev = inferSeverity(r);
      const decay = recencyDecay(r.hours_ago);
      const impact = SEVERITY_WEIGHT[sev] * decay;
      totalImpact += impact;
      breakdown[sev].count++;
      breakdown[sev].impact += impact;
    }

    const score = Math.max(1, Math.round(100 - Math.min(99, totalImpact)));
    const level: 'excellent' | 'good' | 'warning' | 'critical' =
      score >= 90 ? 'excellent' :
      score >= 75 ? 'good' :
      score >= 50 ? 'warning' : 'critical';

    const contributing = (Object.keys(breakdown) as Severity[])
      .filter(s => breakdown[s].count > 0)
      .map(s => ({ severity: s, count: breakdown[s].count, impact: Math.round(breakdown[s].impact * 10) / 10 }))
      .sort((a, b) => b.impact - a.impact);

    return { score, level, contributing };
  } catch (err: unknown) {
    logger.error('HealthScore', '计算当前健康度失败', { error: (err as Error).message });
    return { score: 0, level: 'critical', contributing: [] };
  }
}

/**
 * 24 小时每小时健康度趋势（每个小时点：以该小时为窗口结束往前 24h 算分）
 * 简化版：仅返回每小时新增告警的累计 impact，便于画 sparkline
 */
export function queryHourlyTrend(hours = 24): Array<{ hour: string; score: number; alarms: number }> {
  try {
    const rows = getDb().prepare(`
      SELECT
        strftime('%H', datetime(started_at)) AS hour_label,
        conclusion,
        priority,
        (julianday('now') - julianday(datetime(started_at, '-8 hours'))) * 24 AS hours_ago
      FROM alarm_records
      WHERE started_at >= datetime('now', '-${hours} hours')
        AND is_test != 2
        AND status != 'processing'
    `).all() as Array<{ hour_label: string; conclusion: string | null; priority: string; hours_ago: number }>;

    // 按小时桶分组累计 impact
    const bucket = new Map<string, { impact: number; count: number }>();
    for (const r of rows) {
      const sev = inferSeverity(r);
      const decay = recencyDecay(r.hours_ago);
      const impact = SEVERITY_WEIGHT[sev] * decay;
      const slot = bucket.get(r.hour_label) ?? { impact: 0, count: 0 };
      slot.impact += impact;
      slot.count++;
      bucket.set(r.hour_label, slot);
    }

    // 补全 24 个小时格（用北京时间小时）
    const result: Array<{ hour: string; score: number; alarms: number }> = [];
    const now = new Date();
    for (let i = hours - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600000 + 8 * 3600000);
      const hh = String(d.getUTCHours()).padStart(2, '0');
      const slot = bucket.get(hh) ?? { impact: 0, count: 0 };
      const score = Math.max(1, Math.round(100 - Math.min(99, slot.impact)));
      result.push({ hour: hh + ':00', score, alarms: slot.count });
    }
    return result;
  } catch (err: unknown) {
    logger.error('HealthScore', '查询小时趋势失败', { error: (err as Error).message });
    return [];
  }
}
