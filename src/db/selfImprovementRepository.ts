import { getDb } from './database.js';
import { logger } from '../utils/logger.js';

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
 * 用户给出反馈（accepted / rejected），仅更新数据库
 * 注：原版本会将 accepted 建议追加到 self-improvement.md，该文件已废弃
 * 经验沉淀改走 alarm_records 表的种子机制（is_test=2）
 */
export function updateSelfImprovementFeedback(
  id: number,
  feedback: 'accepted' | 'rejected',
  note?: string,
): void {
  try {
    const db = getDb();

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
  } catch (err: unknown) {
    logger.error('SelfImprovementRepository', '更新改进建议反馈失败', {
      id,
      error: (err as Error).message,
    });
  }
}
