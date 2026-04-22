import { describe, it, expect, beforeEach } from 'vitest';
import { AlarmQueue } from '../src/gateway/alarmQueue.js';
import { SessionManager } from '../src/gateway/sessionManager.js';
import type { Alarm } from '../src/types/index.js';

function mkAlarm(id: string, priority: 'P0' | 'P1' | 'P2' | 'P3'): Alarm {
  return {
    alarmId: id,
    alarmType: 'test',
    faultCategory: 'software',
    deviceId: 'pcs',
    timestamp: '2026-04-22T10:00:00+08:00',
    priority,
  };
}

describe('AlarmQueue 优先级（P3 最严重约定）', () => {
  let sessionMgr: SessionManager;
  let queue: AlarmQueue;

  beforeEach(() => {
    sessionMgr = new SessionManager();
    queue = new AlarmQueue(sessionMgr);
  });

  it('P3 必须先于 P2/P1/P0 被 pop 出来', () => {
    queue.push(mkAlarm('a-P0', 'P0'));
    queue.push(mkAlarm('a-P1', 'P1'));
    queue.push(mkAlarm('a-P2', 'P2'));
    queue.push(mkAlarm('a-P3', 'P3'));
    expect(queue.pop()?.alarmId).toBe('a-P3');
    expect(queue.pop()?.alarmId).toBe('a-P2');
    expect(queue.pop()?.alarmId).toBe('a-P1');
    expect(queue.pop()?.alarmId).toBe('a-P0');
  });

  it('popByPriority 只取指定优先级，不影响其他', () => {
    queue.push(mkAlarm('a-P2', 'P2'));
    queue.push(mkAlarm('a-P3', 'P3'));
    queue.push(mkAlarm('b-P3', 'P3'));
    const first = queue.popByPriority('P3');
    expect(first?.alarmId).toBe('a-P3');
    const second = queue.popByPriority('P3');
    expect(second?.alarmId).toBe('b-P3');
    const none = queue.popByPriority('P3');
    expect(none).toBeUndefined();
    // P2 告警保留
    expect(queue.pop()?.alarmId).toBe('a-P2');
  });

  it('同 alarmId 重复入队会被去重', () => {
    queue.push(mkAlarm('dup', 'P2'));
    queue.push(mkAlarm('dup', 'P2'));
    expect(queue.length).toBe(1);
  });

  it('正在处理中的告警不会再次入队', () => {
    sessionMgr.start('proc');
    queue.push(mkAlarm('proc', 'P2'));
    expect(queue.length).toBe(0);
  });
});
