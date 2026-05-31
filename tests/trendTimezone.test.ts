import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { computeCurrentScore, queryHourlyTrend } from '../src/server/healthScore.js';
import { queryAlarmTrend } from '../src/db/alarmRepository.js';
import { beijingCutoffHours, clampHours } from '../src/utils/time.js';

/**
 * 时区根因回归测试（见 llm-ai/error-api-时区-2026-06-01.md）
 *
 * started_at 以北京时间 +08:00 存储。断言：
 *   - 健康分 hours_ago 不再多偏 8h（新 critical → decay≈1.0 → 分=75，旧 bug 会给 83）
 *   - 趋势图分桶键与当前北京小时对齐（旧 bug：SQL 用 UTC/UTC-8，JS 用北京，错位永远 miss）
 *   - 24h 窗口边界正确（30h 前告警不计入）
 *   - hours 参数被收敛（NaN/负/超大不致崩或越界）
 */

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE alarm_records (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT    NOT NULL,
      conclusion TEXT,
      priority   TEXT,
      status     TEXT    NOT NULL DEFAULT 'done',
      is_test    INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

/** 插入一条「hoursAgo 小时前」的告警（北京 +08:00 格式） */
function seed(db: Database.Database, hoursAgo: number, priority = 'P3', is_test = 0): void {
  db.prepare(
    `INSERT INTO alarm_records (started_at, conclusion, priority, status, is_test)
     VALUES (?, NULL, ?, 'done', ?)`,
  ).run(beijingCutoffHours(hoursAgo), priority, is_test);
}

/** 当前北京小时标签，如 "08:00" */
function currentBeijingHourLabel(): string {
  return String(new Date(Date.now() + 8 * 3600000).getUTCHours()).padStart(2, '0') + ':00';
}

describe('clampHours', () => {
  it('正常值原样（取整）', () => {
    expect(clampHours(24)).toBe(24);
    expect(clampHours(12.9)).toBe(12);
  });
  it('NaN / 0 / 负数 → 默认 24', () => {
    expect(clampHours(NaN)).toBe(24);
    expect(clampHours(0)).toBe(24);
    expect(clampHours(-5)).toBe(24);
    expect(clampHours('oops')).toBe(24);
  });
  it('超大值 → 上限 168', () => {
    expect(clampHours(99999)).toBe(168);
  });
});

describe('computeCurrentScore — hours_ago 不再多偏 8 小时', () => {
  it('刚发生的 critical（P3）→ decay≈1.0 → 分=75（旧 bug 会算成 83）', () => {
    const db = makeDb();
    seed(db, 0, 'P3');
    const { score, level, contributing } = computeCurrentScore(db);
    expect(score).toBe(75);
    expect(level).toBe('good');
    expect(contributing).toEqual([{ severity: 'critical', count: 1, impact: 25 }]);
  });

  it('24h 窗口：30 小时前的告警不计入', () => {
    const db = makeDb();
    seed(db, 30, 'P3');
    const { score, contributing } = computeCurrentScore(db);
    expect(score).toBe(100);
    expect(contributing).toEqual([]);
  });

  it('经验种子 is_test=2 被排除', () => {
    const db = makeDb();
    seed(db, 0, 'P3', 2);
    expect(computeCurrentScore(db).score).toBe(100);
  });
});

describe('queryAlarmTrend — 分桶键与北京时间对齐', () => {
  it('刚发生的告警落在最后一格（当前北京小时），计数为 1', () => {
    const db = makeDb();
    seed(db, 0);
    const trend = queryAlarmTrend(24, db);
    expect(trend).toHaveLength(24);
    const last = trend[trend.length - 1]!;
    expect(last.hour).toBe(currentBeijingHourLabel());
    expect(last.count).toBe(1);
    // 其余格子合计为 0（仅一条告警）
    const others = trend.slice(0, -1).reduce((s, t) => s + t.count, 0);
    expect(others).toBe(0);
  });

  it('hours 被收敛：0→24 格，负数→24 格，超大→168 格', () => {
    const db = makeDb();
    expect(queryAlarmTrend(0, db)).toHaveLength(24);
    expect(queryAlarmTrend(-5, db)).toHaveLength(24);
    expect(queryAlarmTrend(99999, db)).toHaveLength(168);
  });
});

describe('queryHourlyTrend — 分桶键与北京时间对齐', () => {
  it('刚发生的 critical 落在当前北京小时格：alarms≥1 且 score<100', () => {
    const db = makeDb();
    seed(db, 0, 'P3');
    const trend = queryHourlyTrend(24, db);
    expect(trend).toHaveLength(24);
    const slot = trend.find(t => t.hour === currentBeijingHourLabel());
    expect(slot).toBeDefined();
    expect(slot!.alarms).toBeGreaterThanOrEqual(1);
    expect(slot!.score).toBeLessThan(100);
  });
});
