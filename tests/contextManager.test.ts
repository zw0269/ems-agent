import { describe, it, expect } from 'vitest';
import { ContextManager } from '../src/runtime/contextManager.js';

describe('ContextManager 上下文管理', () => {
  it('addSystem / addUser / addAssistant 顺序保持', () => {
    const cm = new ContextManager();
    cm.addSystem('sys');
    cm.addUser('u1');
    cm.addAssistant('a1');
    const msgs = cm.get();
    expect(msgs).toHaveLength(3);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[1]?.role).toBe('user');
    expect(msgs[2]?.role).toBe('assistant');
  });

  it('addAssistant 带 toolCalls 时序列化到 tool_calls 字段', () => {
    const cm = new ContextManager();
    cm.addAssistant('', [{ id: 'call-1', name: 'getPcsYc', args: {} }]);
    const asst = cm.get()[0];
    expect(asst?.tool_calls).toHaveLength(1);
    expect(asst?.tool_calls?.[0]?.id).toBe('call-1');
    expect(asst?.tool_calls?.[0]?.function.name).toBe('getPcsYc');
    expect(asst?.tool_calls?.[0]?.function.arguments).toBe('{}');
  });

  it('addToolResult 会关联 tool_call_id', () => {
    const cm = new ContextManager();
    cm.addAssistant('', [{ id: 'call-1', name: 'getPcsYc', args: {} }]);
    cm.addToolResult('getPcsYc', { foo: 'bar' }, 'call-1');
    const tool = cm.get()[1];
    expect(tool?.role).toBe('tool');
    expect(tool?.tool_call_id).toBe('call-1');
    expect(tool?.content).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('大量消息后能维持 system 消息不被丢失', () => {
    const cm = new ContextManager();
    cm.addSystem('persistent-system-prompt');
    cm.addUser('u1');
    // 塞入大量长消息触发 compact
    const big = 'x'.repeat(10000);
    for (let i = 0; i < 20; i++) {
      cm.addAssistant('', [{ id: `c${i}`, name: 'getPcsYc', args: { payload: big } }]);
      cm.addToolResult('getPcsYc', { data: big }, `c${i}`);
    }
    const msgs = cm.get();
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toBe('persistent-system-prompt');
  });
});
