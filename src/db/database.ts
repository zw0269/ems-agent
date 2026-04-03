import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const DB_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'ems-agent.db');

let _db: Database.Database | null = null;

/**
 * 获取（或初始化）数据库单例
 * 数据库文件：data/ems-agent.db
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');   // 写性能优化
  _db.pragma('foreign_keys = ON');

  _db.exec(`
    CREATE TABLE IF NOT EXISTS alarm_records (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      alarm_id       TEXT    NOT NULL UNIQUE,
      alarm_type     TEXT    NOT NULL,
      fault_category TEXT    NOT NULL,
      device_id      TEXT    NOT NULL,
      priority       TEXT    NOT NULL,
      alarm_timestamp TEXT   NOT NULL,
      started_at     TEXT    NOT NULL,
      finished_at    TEXT,
      duration_ms    INTEGER,
      status         TEXT    NOT NULL DEFAULT 'processing',
      conclusion     TEXT,
      is_test        INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_alarm_records_started_at
      ON alarm_records(started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_alarm_records_status
      ON alarm_records(status);

    -- 每次 LLM API 调用的完整输入输出记录
    CREATE TABLE IF NOT EXISTS llm_calls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      alarm_id        TEXT    NOT NULL,
      call_index      INTEGER NOT NULL DEFAULT 0,
      provider        TEXT    NOT NULL,
      model           TEXT    NOT NULL,
      input_messages  TEXT    NOT NULL,
      output_json     TEXT    NOT NULL,
      duration_ms     INTEGER NOT NULL,
      input_tokens    INTEGER NOT NULL DEFAULT 0,
      output_tokens   INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_llm_calls_alarm_id
      ON llm_calls(alarm_id);

    CREATE INDEX IF NOT EXISTS idx_llm_calls_created_at
      ON llm_calls(created_at DESC);

    -- 每次告警采集的实时设备数据快照
    CREATE TABLE IF NOT EXISTS realtime_snapshots (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      alarm_id      TEXT    NOT NULL,
      snapshot_json TEXT    NOT NULL,
      captured_at   TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_realtime_snapshots_alarm_id
      ON realtime_snapshots(alarm_id);

    -- AI 自我反思改进建议及用户反馈
    CREATE TABLE IF NOT EXISTS self_improvements (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      alarm_id        TEXT    NOT NULL,
      suggestion_text TEXT    NOT NULL,
      user_feedback   TEXT,
      feedback_note   TEXT,
      created_at      TEXT    NOT NULL,
      feedback_at     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_self_improvements_alarm_id
      ON self_improvements(alarm_id);

    CREATE INDEX IF NOT EXISTS idx_self_improvements_feedback
      ON self_improvements(user_feedback);

    -- LLM 工具调用返回的 EMS 告警数据
    CREATE TABLE IF NOT EXISTS ems_alarms (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      ems_id       INTEGER NOT NULL,
      alarm_id     TEXT    NOT NULL,
      source       TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      level        TEXT    NOT NULL,
      device_type  TEXT    NOT NULL,
      alarm_time   TEXT    NOT NULL,
      recover_time TEXT,
      created_at   TEXT    NOT NULL,
      UNIQUE(ems_id, alarm_id, source)
    );

    CREATE INDEX IF NOT EXISTS idx_ems_alarms_alarm_id
      ON ems_alarms(alarm_id);

    CREATE INDEX IF NOT EXISTS idx_ems_alarms_created_at
      ON ems_alarms(created_at DESC);
  `);

  // 迁移：对已有数据库补充 token 字段（IF NOT EXISTS 语义通过 try/catch 模拟）
  try { _db.exec(`ALTER TABLE llm_calls ADD COLUMN input_tokens  INTEGER NOT NULL DEFAULT 0`); } catch { /* 列已存在，忽略 */ }
  try { _db.exec(`ALTER TABLE llm_calls ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0`); } catch { /* 列已存在，忽略 */ }

  logger.info('Database', '数据库已初始化', { path: DB_PATH });
  return _db;
}
