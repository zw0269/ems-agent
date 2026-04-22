import { describe, it, expect } from 'vitest';
import { validateToolArgs } from '../src/runtime/toolRouter.js';

describe('validateToolArgs — R3 工具参数校验', () => {
  it('未知工具立即拒绝', () => {
    expect(validateToolArgs('unknownTool', {})).toMatch(/未知工具/);
  });

  it('无参工具允许空/null/undefined args', () => {
    expect(validateToolArgs('getHomePage', null)).toBeNull();
    expect(validateToolArgs('getHomePage', undefined)).toBeNull();
    expect(validateToolArgs('getHomePage', {})).toBeNull();
  });

  it('带必填 index 的工具缺参数时拒绝', () => {
    expect(validateToolArgs('getMeterYc', {})).toMatch(/缺少必填参数: index/);
    expect(validateToolArgs('getMeterYc', null)).toMatch(/缺少必填参数: index/);
  });

  it('类型错误时拒绝（number 字段收到 string）', () => {
    expect(validateToolArgs('getMeterYc', { index: 'zero' })).toMatch(/类型应为 number/);
  });

  it('queryPcs.fields 数组内非字符串应拒绝', () => {
    expect(validateToolArgs('queryPcs', { fields: ['a', 123] })).toMatch(/类型应为 string/);
  });

  it('queryPcs.fields 超长字符串应拒绝', () => {
    const long = 'x'.repeat(300);
    expect(validateToolArgs('queryPcs', { fields: [long] })).toMatch(/超长/);
  });

  it('合法调用返回 null', () => {
    expect(validateToolArgs('getMeterYc', { index: 0 })).toBeNull();
    expect(validateToolArgs('queryPcs', { fields: ['voltage', 'current'] })).toBeNull();
    expect(validateToolArgs('getHistoryAlarms', { startTime: '2026-04-22 10:00:00' })).toBeNull();
  });

  it('args 不是对象应拒绝', () => {
    expect(validateToolArgs('queryPcs', 'string_arg' as any)).toMatch(/必须是对象/);
    expect(validateToolArgs('queryPcs', ['array_arg'] as any)).toMatch(/必须是对象/);
  });
});
