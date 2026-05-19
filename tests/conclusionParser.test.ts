import { describe, it, expect } from 'vitest';
import { parseConclusion, confidenceBadge, severityBadge } from '../src/utils/conclusionParser.js';

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
