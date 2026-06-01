import { describe, it, expect } from 'vitest';
import { firstChoiceMessage } from '../src/llm/client.js';

/**
 * 回归：网关返回非 OpenAI 响应体时，不再抛不可诊断的
 * "Cannot read properties of undefined (reading '0')"，
 * 而是抛出含响应体片段的可诊断错误。见 llm/client.ts:firstChoiceMessage。
 */
describe('firstChoiceMessage（防御网关非标准响应）', () => {
  it('正常 OpenAI 响应 → 返回 message', () => {
    const raw = { choices: [{ message: { role: 'assistant', content: 'ok' } }] };
    expect(firstChoiceMessage(raw)).toEqual({ role: 'assistant', content: 'ok' });
  });

  it('网关错误体（无 choices）→ 抛含响应体的可诊断错误，而非 "reading 0" 崩溃', () => {
    const raw = { type: 'error', error: { message: '模型 gpt-5.5 暂不支持' } };
    expect(() => firstChoiceMessage(raw)).toThrowError(/choices\[0\]/);
    expect(() => firstChoiceMessage(raw)).toThrowError(/gpt-5\.5/);
  });

  it('undefined / 空 choices → 抛错不崩', () => {
    expect(() => firstChoiceMessage(undefined)).toThrowError(/choices\[0\]/);
    expect(() => firstChoiceMessage({ choices: [] })).toThrowError(/choices\[0\]/);
  });
});
