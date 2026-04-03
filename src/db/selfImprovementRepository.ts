import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './database.js';
import { logger } from '../utils/logger.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const SELF_IMPROVEMENT_PATH = path.join(ROOT, 'self-improvement.md');

export interface SelfImprovementRecord {
  id: number;
  alarm_id: string;
  suggestion_text: string;
  user_feedback: 'accepted' | 'rejected' | null;
  feedback_note: string | null;
  created_at: string;
  feedback_at: string | null;
}

function nowBeijing(): string {
  const offsetMs = 8 * 60 * 60 * 1000;
  return new Date(Date.now() + offsetMs).toISOString().replace('Z', '+08:00');
}

/**
 * 保存 AI 自我反思建议（初始状态 pending，user_feedback = NULL）
 * 返回插入记录的 id
 */
export function insertSelfImprovement(alarmId: string, suggestionText: string): number {
  try {
    const result = getDb().prepare(`
      INSERT INTO self_improvements (alarm_id, suggestion_text, created_at)
      VALUES (@alarm_id, @suggestion_text, @created_at)
    `).run({
      alarm_id:        alarmId,
      suggestion_text: suggestionText,
      created_at:      nowBeijing(),
    });
    return Number(result.lastInsertRowid);
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '写入改进建议失败', {
      alarmId,
      error: (err as Error).message,
    });
    return -1;
  }
}

/**
 * 查询所有待处理（user_feedback IS NULL）的建议
 */
export function queryPendingSelfImprovements(): SelfImprovementRecord[] {
  try {
    return getDb()
      .prepare(`
        SELECT * FROM self_improvements
        WHERE user_feedback IS NULL
        ORDER BY created_at DESC
      `)
      .all() as SelfImprovementRecord[];
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '查询待处理建议失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 查询最近 N 条改进建议（含已处理）
 */
export function queryRecentSelfImprovements(limit = 50): SelfImprovementRecord[] {
  try {
    return getDb()
      .prepare('SELECT * FROM self_improvements ORDER BY created_at DESC LIMIT ?')
      .all(limit) as SelfImprovementRecord[];
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '查询改进建议失败', { error: (err as Error).message });
    return [];
  }
}

/**
 * 聚合所有已接受建议，重写 self-improvement.md（方案B：定期整理去重）
 * 将 DB 中 user_feedback='accepted' 的全部建议按创建时间排序，
 * 去除重复内容后写成干净的 Markdown 文件，供 buildSystemPrompt() 读取。
 */
export function aggregateAcceptedSuggestions(): void {
  try {
    const records = getDb()
      .prepare(`
        SELECT alarm_id, suggestion_text, created_at, feedback_note
        FROM self_improvements
        WHERE user_feedback = 'accepted'
        ORDER BY created_at ASC
      `)
      .all() as Array<{ alarm_id: string; suggestion_text: string; created_at: string; feedback_note: string | null }>;

    if (records.length === 0) {
      // 无已接受建议时写空文件（保留标题）
      fs.writeFileSync(SELF_IMPROVEMENT_PATH, '# EMS Agent 自我改进积累\n\n> 暂无已接受的改进建议。\n', 'utf8');
      logger.info('SelfImprovementRepository', '无已接受建议，self-improvement.md 已清空');
      return;
    }

    // 按 suggestion_text 去重（保留最新的那条）
    const seen = new Set<string>();
    const unique = records.filter(r => {
      const key = r.suggestion_text.trim().slice(0, 100); // 前100字作为去重key
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const lines: string[] = [
      '# EMS Agent 自我改进积累',
      '',
      `> 最近一次聚合：${nowBeijing()}，共 ${unique.length} 条建议（原始 ${records.length} 条，去重后 ${unique.length} 条）`,
      '',
      '---',
    ];

    for (const r of unique) {
      lines.push('');
      lines.push(`## ${r.created_at} (alarmId: ${r.alarm_id})`);
      lines.push('');
      lines.push(r.suggestion_text);
      if (r.feedback_note) {
        lines.push('');
        lines.push(`> 用户备注：${r.feedback_note}`);
      }
      lines.push('');
      lines.push('---');
    }

    fs.writeFileSync(SELF_IMPROVEMENT_PATH, lines.join('\n'), 'utf8');
    logger.info('SelfImprovementRepository', 'self-improvement.md 聚合完成', {
      total: records.length,
      unique: unique.length,
    });
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '聚合 self-improvement.md 失败', {
      error: (err as Error).message,
    });
  }
}

/**
 * 用户给出反馈（accepted / rejected）
 * 若接受，则追加建议内容到 self-improvement.md
 */
export function updateSelfImprovementFeedback(
  id: number,
  feedback: 'accepted' | 'rejected',
  note?: string,
): void {
  try {
    const db = getDb();

    // 先查出原记录以获取 suggestion_text 和 alarm_id
    const record = db
      .prepare('SELECT * FROM self_improvements WHERE id = ?')
      .get(id) as SelfImprovementRecord | undefined;

    if (!record) {
      logger.warn('SelfImprovementRepository', '未找到改进建议记录', { id });
      return;
    }

    db.prepare(`
      UPDATE self_improvements
      SET user_feedback = @user_feedback,
          feedback_note = @feedback_note,
          feedback_at   = @feedback_at
      WHERE id = @id
    `).run({
      id,
      user_feedback: feedback,
      feedback_note: note ?? null,
      feedback_at:   nowBeijing(),
    });

    // 接受时追加到 self-improvement.md
    if (feedback === 'accepted') {
      const entry = [
        '',
        `## ${nowBeijing()} (alarmId: ${record.alarm_id})`,
        '',
        record.suggestion_text,
        note ? `\n> 用户备注：${note}` : '',
        '',
        '---',
      ].join('\n');

      fs.appendFileSync(SELF_IMPROVEMENT_PATH, entry, 'utf8');
      logger.info('SelfImprovementRepository', '已追加改进建议到 self-improvement.md', {
        id,
        alarmId: record.alarm_id,
      });
    }
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '更新改进建议反馈失败', {
      id,
      error: (err as Error).message,
    });
  }
}
