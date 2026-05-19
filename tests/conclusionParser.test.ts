import { describe, it, expect } from 'vitest';
import { parseConclusion, confidenceBadge, severityBadge, parseVerifier, mergeVerifierInto } from '../src/utils/conclusionParser.js';

describe('parseConclusion', () => {
  it('完整结构解析成功', () => {
    const conclusion = `**置信度**：85 | **严重度**：high
**根因**：直流母线采样系数错误
**证据链**：UpVol+DownVol=956V → 与 TotalDirectVol 偏差 13%
**操作建议**：
- [远程核查|风险:low] 读取采样系数
- [停机电测|风险:medium] 万用表实测
- [人工现场|风险:high] 端子拆解检查`;

    const p = parseConclusion(conclusion);
    expect(p.confidence).toBe(85);
    expect(p.severity).toBe('high');
    expect(p.rootCause).toContain('采样系数');
    expect(p.actionCount).toBe(3);
    expect(p.highRiskActions).toBe(1);
  });

  it('缺失置信度时返回 -1', () => {
    const p = parseConclusion(`**根因**：xxx\n**操作建议**：\n- [远程核查] yyy`);
    expect(p.confidence).toBe(-1);
    expect(p.severity).toBe('unknown');
  });

  it('非法置信度（>100）忽略', () => {
    const p = parseConclusion('**置信度**：250');
    expect(p.confidence).toBe(-1);
  });

  it('容错：空字符串与 null', () => {
    expect(parseConclusion('').confidence).toBe(-1);
    expect(parseConclusion(null as unknown as string).confidence).toBe(-1);
  });
});

describe('confidenceBadge', () => {
  it('高/中/低分档', () => {
    expect(confidenceBadge(90)).toContain('高');
    expect(confidenceBadge(70)).toContain('中');
    expect(confidenceBadge(50)).toContain('低');
    expect(confidenceBadge(-1)).toContain('未知');
  });
});

describe('severityBadge', () => {
  it('每档有对应中文标签', () => {
    expect(severityBadge('critical')).toContain('严重');
    expect(severityBadge('high')).toContain('高');
    expect(severityBadge('unknown')).toBe('');
  });
});

describe('parseVerifier', () => {
  it('完整复核结论解析', () => {
    const text = `**复核结论**：disagreed
**异议要点**：[未读取保护定值寄存器即下结论"阈值过敏"过于自信]
**置信度调整**：-20`;
    const v = parseVerifier(text);
    expect(v.verdict).toBe('disagreed');
    expect(v.dissent).toContain('保护定值');
    expect(v.confidenceDelta).toBe(-20);
  });

  it('agreed 时无异议', () => {
    const v = parseVerifier(`**复核结论**：agreed\n**异议要点**：无异议\n**置信度调整**：0`);
    expect(v.verdict).toBe('agreed');
    expect(v.confidenceDelta).toBe(0);
  });

  it('容错：空字符串', () => {
    const v = parseVerifier('');
    expect(v.verdict).toBe('unknown');
    expect(v.confidenceDelta).toBe(0);
  });

  it('非法 delta 忽略', () => {
    const v = parseVerifier(`**置信度调整**：-99`);
    expect(v.confidenceDelta).toBe(0); // 超出 -30~+10 范围
  });
});

describe('mergeVerifierInto', () => {
  const conclusion = `**置信度**：85 | **严重度**：high\n**根因**：xxx\n**操作建议**：\n- [远程核查] yyy`;

  it('agreed 不修改原结论', () => {
    const merged = mergeVerifierInto(conclusion, { verdict: 'agreed', dissent: '', confidenceDelta: 0, raw: '' });
    expect(merged).toBe(conclusion);
  });

  it('disagreed 加 banner 并调整置信度', () => {
    const merged = mergeVerifierInto(conclusion, { verdict: 'disagreed', dissent: '证据不足', confidenceDelta: -20, raw: '' });
    expect(merged).toContain('[复核 disagreed]');
    expect(merged).toContain('证据不足');
    expect(merged).toContain('**置信度**：65'); // 85 - 20
  });

  it('partial 加 banner，0 delta 不改置信度', () => {
    const merged = mergeVerifierInto(conclusion, { verdict: 'partial', dissent: '建议缺失 SOE 步骤', confidenceDelta: 0, raw: '' });
    expect(merged).toContain('[复核 partial]');
    expect(merged).toContain('**置信度**：85'); // 不变
  });

  it('置信度调整 clamp 到 [0, 100]', () => {
    const c = `**置信度**：95\n**根因**：xxx`;
    const merged = mergeVerifierInto(c, { verdict: 'partial', dissent: '过于乐观', confidenceDelta: 10, raw: '' });
    expect(merged).toContain('**置信度**：100'); // 不超过 100
  });
});
