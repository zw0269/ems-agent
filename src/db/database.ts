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
  `);

  logger.info('Database', '数据库已初始化', { path: DB_PATH });
  return _db;
}
