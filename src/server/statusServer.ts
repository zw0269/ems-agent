import express from 'express';
import { statusStore } from './statusStore.js';
import { queryRecentAlarms, queryAlarmsByRange, queryStats } from '../db/alarmRepository.js';
import { queryRecentLlmCalls, queryLlmCallsByAlarm } from '../db/llmCallRepository.js';
import {
  queryPendingSelfImprovements,
  queryRecentSelfImprovements,
  updateSelfImprovementFeedback,
} from '../db/selfImprovementRepository.js';
import type { AlarmQueue } from '../gateway/alarmQueue.js';
import type { Alarm } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EMS Agent 状态面板</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3e;
    --text: #e2e8f0; --muted: #6b7280; --accent: #6366f1;
    --green: #22c55e; --red: #ef4444; --yellow: #f59e0b; --blue: #3b82f6;
  }
  body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; }
  header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 16px 24px; display: flex; align-items: center; gap: 12px;
  }
  header h1 { font-size: 18px; font-weight: 600; }
  header .badge {
    background: var(--accent); color: #fff; padding: 2px 8px;
    border-radius: 9999px; font-size: 11px; font-weight: 500;
  }
  .refresh-info { margin-left: auto; color: var(--muted); font-size: 12px; }
  main { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px;
  }
  .card-title { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .card-value { font-size: 28px; font-weight: 700; }
  .card-sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .dot-red   { background: var(--red);   box-shadow: 0 0 6px var(--red);   }
  .dot-yellow{ background: var(--yellow);box-shadow: 0 0 6px var(--yellow);}
  .dot-grey  { background: var(--muted); }
  .section-title { font-size: 13px; font-weight: 600; color: var(--muted); text-transform: uppercase;
    letter-spacing: .08em; margin-bottom: 12px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .info-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .info-row { display: flex; justify-content: space-between; align-items: center;
    padding: 6px 0; border-bottom: 1px solid var(--border); }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: var(--muted); }
  .info-value { font-weight: 500; max-width: 60%; text-align: right; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; background: var(--surface);
    border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  thead { background: #12141f; }
  th { padding: 10px 14px; text-align: left; color: var(--muted); font-size: 11px;
    text-transform: uppercase; letter-spacing: .05em; }
  td { padding: 10px 14px; border-top: 1px solid var(--border); vertical-align: top; }
  tr:hover td { background: rgba(255,255,255,.02); }
  .tag {
    display: inline-block; padding: 2px 8px; border-radius: 9999px;
    font-size: 11px; font-weight: 600;
  }
  .tag-p0 { background: rgba(239,68,68,.15); color: var(--red); }
  .tag-p1 { background: rgba(245,158,11,.15); color: var(--yellow); }
  .tag-p2 { background: rgba(59,130,246,.15); color: var(--blue); }
  .tag-p3 { background: rgba(107,114,128,.15); color: var(--muted); }
  .tag-done { background: rgba(34,197,94,.15); color: var(--green); }
  .tag-error { background: rgba(239,68,68,.15); color: var(--red); }
  .tag-processing { background: rgba(99,102,241,.15); color: var(--accent); }
  .conclusion { color: var(--muted); font-size: 12px; max-width: 300px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { text-align: center; color: var(--muted); padding: 32px; }

  /* 测试面板 */
  .test-panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px; margin-bottom: 24px;
  }
  .test-panel .section-title { margin-bottom: 16px; color: var(--yellow); }
  .test-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; align-items: end; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  .form-group input, .form-group select {
    background: #12141f; border: 1px solid var(--border); border-radius: 8px;
    color: var(--text); padding: 8px 12px; font-size: 13px; outline: none;
    transition: border-color .15s;
  }
  .form-group input:focus, .form-group select:focus { border-color: var(--accent); }
  .btn-submit {
    background: var(--accent); color: #fff; border: none; border-radius: 8px;
    padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer;
    transition: opacity .15s; white-space: nowrap;
  }
  .btn-submit:hover { opacity: .85; }
  .btn-submit:disabled { opacity: .4; cursor: not-allowed; }
  .test-result {
    margin-top: 12px; padding: 10px 14px; border-radius: 8px;
    font-size: 12px; display: none;
  }
  .test-result.ok  { background: rgba(34,197,94,.1);  color: var(--green); border: 1px solid rgba(34,197,94,.3);  }
  .test-result.err { background: rgba(239,68,68,.1);  color: var(--red);   border: 1px solid rgba(239,68,68,.3);  }

  @media (max-width: 768px) { .info-grid { grid-template-columns: 1fr; } }

  /* 自我改进建议面板 */
  .suggestion-card {
    background: #12141f; border: 1px solid var(--border); border-radius: 8px;
    padding: 14px; margin-bottom: 10px;
  }
  .suggestion-meta { color: var(--muted); font-size: 11px; margin-bottom: 8px; }
  .suggestion-text { font-size: 13px; line-height: 1.7; white-space: pre-wrap; margin-bottom: 10px; }
  .suggestion-actions { display: flex; gap: 8px; align-items: center; }
  .btn-accept {
    background: rgba(34,197,94,.15); color: var(--green);
    border: 1px solid rgba(34,197,94,.3); border-radius: 6px;
    padding: 5px 14px; cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .btn-reject {
    background: rgba(239,68,68,.1); color: var(--red);
    border: 1px solid rgba(239,68,68,.3); border-radius: 6px;
    padding: 5px 14px; cursor: pointer; font-size: 12px;
  }
  .btn-accept:hover { background: rgba(34,197,94,.3); }
  .btn-reject:hover { background: rgba(239,68,68,.25); }
  .suggestion-note {
    flex: 1; background: #12141f; border: 1px solid var(--border); border-radius: 6px;
    color: var(--text); padding: 5px 10px; font-size: 12px; outline: none;
  }
  .suggestion-note:focus { border-color: var(--accent); }
</style>
</head>
<body>
<header>
  <span id="running-dot" class="status-dot dot-green"></span>
  <h1>EMS Agent 状态面板</h1>
  <span class="badge">v1.0</span>
  <span class="refresh-info" id="refresh-info">5s 自动刷新</span>
</header>
<main>
  <!-- 统计卡片 -->
  <div class="grid" id="stats-grid"></div>

  <!-- LLM + 心跳信息 -->
  <div class="info-grid">
    <div class="info-card">
      <div class="section-title">LLM 配置</div>
      <div id="llm-info"></div>
    </div>
    <div class="info-card">
      <div class="section-title">心跳 / 轮询</div>
      <div id="heartbeat-info"></div>
    </div>
  </div>

  <!-- 手动测试告警 -->
  <div class="test-panel">
    <div class="section-title">🧪 手动注入测试告警</div>
    <div class="test-form">
      <div class="form-group">
        <label>告警类型 (alarmType)</label>
        <input id="f-type" type="text" placeholder="如：VF 离网状态" value="VF 离网状态" />
      </div>
      <div class="form-group">
        <label>故障分类</label>
        <select id="f-category">
          <option value="software">software（软件/电气）</option>
          <option value="hardware">hardware（硬件）</option>
        </select>
      </div>
      <div class="form-group">
        <label>设备 ID</label>
        <input id="f-device" type="text" placeholder="如：Pcs" value="Pcs" />
      </div>
      <div class="form-group">
        <label>优先级</label>
        <select id="f-priority">
          <option value="P0">P0 紧急</option>
          <option value="P1">P1 重要</option>
          <option value="P2" selected>P2 一般</option>
          <option value="P3">P3 提示</option>
        </select>
      </div>
      <div class="form-group">
        <label>&nbsp;</label>
        <button class="btn-submit" id="btn-inject" onclick="injectAlarm()">注入告警</button>
      </div>
    </div>
    <div class="test-result" id="test-result"></div>
  </div>

  <!-- AI 自我改进建议 -->
  <div class="test-panel" style="border-color: var(--blue); margin-bottom: 24px;">
    <div class="section-title" style="color: var(--blue)">💡 AI 自我改进建议</div>
    <div id="suggestions-list"><div class="empty">加载中…</div></div>
  </div>

  <!-- 告警历史 -->
  <div class="section-title">最近告警处理记录</div>
  <table>
    <thead>
      <tr>
        <th>告警 ID</th>
        <th>类型</th>
        <th>优先级</th>
        <th>状态</th>
        <th>耗时</th>
        <th>开始时间</th>
        <th>结论摘要</th>
      </tr>
    </thead>
    <tbody id="alarm-tbody"></tbody>
  </table>
</main>

<script>
function fmt(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}
function fmtDuration(ms) {
  if (ms == null) return '-';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}
function priorityTag(p) {
  return '<span class="tag tag-' + p.toLowerCase() + '">' + p + '</span>';
}
function statusTag(s) {
  const map = { done: '完成', error: '错误', processing: '处理中' };
  return '<span class="tag tag-' + s + '">' + (map[s] || s) + '</span>';
}

async function injectAlarm() {
  const btn = document.getElementById('btn-inject');
  const result = document.getElementById('test-result');
  const alarmType = document.getElementById('f-type').value.trim();
  if (!alarmType) { showResult('error', '告警类型不能为空'); return; }

  btn.disabled = true;
  btn.textContent = '注入中…';
  result.style.display = 'none';

  try {
    const res = await fetch('/api/test-alarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alarmType,
        faultCategory: document.getElementById('f-category').value,
        deviceId:      document.getElementById('f-device').value.trim() || 'unknown',
        priority:      document.getElementById('f-priority').value,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      showResult('ok', '✓ 告警已注入队列，alarmId: ' + data.alarmId + '，等待 Agent 处理…');
    } else {
      showResult('err', '✗ ' + (data.error || '注入失败'));
    }
  } catch (e) {
    showResult('err', '✗ 网络错误: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '注入告警';
  }
}

function showResult(type, msg) {
  const el = document.getElementById('test-result');
  el.className = 'test-result ' + (type === 'ok' ? 'ok' : 'err');
  el.textContent = msg;
  el.style.display = 'block';
}

async function refresh() {
  try {
    const res = await fetch('/api/status');
    const d = await res.json();

    // 统计卡片
    const apiColor = d.llmApiOk === true ? 'green' : d.llmApiOk === false ? 'red' : 'grey';
    const apiText  = d.llmApiOk === true ? '已连通' : d.llmApiOk === false ? '连接失败' : '未测试';
    document.getElementById('stats-grid').innerHTML = \`
      <div class="card">
        <div class="card-title">API 状态</div>
        <div class="card-value"><span class="status-dot dot-\${apiColor}"></span>\${apiText}</div>
        <div class="card-sub">\${d.llmProvider} / \${d.llmModel}</div>
      </div>
      <div class="card">
        <div class="card-title">队列待处理</div>
        <div class="card-value">\${d.queueLength}</div>
        <div class="card-sub">告警等待分析</div>
      </div>
      <div class="card">
        <div class="card-title">活跃会话</div>
        <div class="card-value">\${d.activeSessionCount}</div>
        <div class="card-sub">正在处理中</div>
      </div>
      <div class="card">
        <div class="card-title">累计处理</div>
        <div class="card-value">\${d.totalProcessed}</div>
        <div class="card-sub">成功 / \${d.totalErrors} 错误</div>
      </div>
      <div class="card">
        <div class="card-title">启动时间</div>
        <div class="card-value" style="font-size:14px;margin-top:4px">\${fmt(d.startedAt)}</div>
        <div class="card-sub">Agent 运行中</div>
      </div>
    \`;

    // LLM 信息
    document.getElementById('llm-info').innerHTML = \`
      <div class="info-row"><span class="info-label">Provider</span><span class="info-value">\${d.llmProvider}</span></div>
      <div class="info-row"><span class="info-label">Model</span><span class="info-value">\${d.llmModel}</span></div>
      <div class="info-row"><span class="info-label">Base URL</span><span class="info-value" title="\${d.llmBaseUrl}">\${d.llmBaseUrl}</span></div>
      <div class="info-row"><span class="info-label">API 连通</span><span class="info-value">
        <span class="status-dot dot-\${apiColor}"></span>\${apiText}
      </span></div>
    \`;

    // 心跳信息
    const hb = d.lastHeartbeat;
    if (hb) {
      const hbColor = hb.ok ? 'green' : 'red';
      document.getElementById('heartbeat-info').innerHTML = \`
        <div class="info-row"><span class="info-label">最后轮询</span><span class="info-value">\${fmt(hb.time)}</span></div>
        <div class="info-row"><span class="info-label">本次告警数</span><span class="info-value">\${hb.alarmCount}</span></div>
        <div class="info-row"><span class="info-label">状态</span><span class="info-value">
          <span class="status-dot dot-\${hbColor}"></span>\${hb.ok ? '正常' : '失败'}
        </span></div>
        \${hb.error ? '<div class="info-row"><span class="info-label">错误</span><span class="info-value" style="color:var(--red)">' + hb.error + '</span></div>' : ''}
      \`;
    } else {
      document.getElementById('heartbeat-info').innerHTML = '<div class="empty">尚未触发轮询</div>';
    }

    // 告警历史表格
    const tbody = document.getElementById('alarm-tbody');
    if (!d.recentAlarms.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无告警处理记录</td></tr>';
    } else {
      tbody.innerHTML = d.recentAlarms.map(a => \`
        <tr>
          <td style="font-family:monospace;font-size:12px">\${a.alarmId}</td>
          <td>\${a.alarmType}</td>
          <td>\${priorityTag(a.priority)}</td>
          <td>\${statusTag(a.status)}</td>
          <td>\${fmtDuration(a.durationMs)}</td>
          <td style="font-size:12px;color:var(--muted)">\${fmt(a.startedAt)}</td>
          <td><div class="conclusion">\${a.conclusion || '-'}</div></td>
        </tr>
      \`).join('');
    }

    document.getElementById('refresh-info').textContent = '已更新 ' + new Date().toLocaleTimeString('zh-CN', {hour12:false});
  } catch(e) {
    document.getElementById('running-dot').className = 'status-dot dot-red';
  }
}

// ─── 自我改进建议 ────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function loadSuggestions() {
  try {
    const res = await fetch('/api/self-improvements?pending=true');
    const d = await res.json();
    const el = document.getElementById('suggestions-list');
    if (!d.records || !d.records.length) {
      el.innerHTML = '<div class="empty">暂无待处理改进建议</div>';
      return;
    }
    el.innerHTML = d.records.map(s => \`
      <div class="suggestion-card" id="suggestion-\${s.id}">
        <div class="suggestion-meta">
          告警 ID: <strong>\${escHtml(s.alarm_id)}</strong>
          &nbsp;·&nbsp; \${fmt(s.created_at)}
        </div>
        <div class="suggestion-text">\${escHtml(s.suggestion_text)}</div>
        <div class="suggestion-actions">
          <input class="suggestion-note" id="note-\${s.id}" type="text" placeholder="可选：添加备注说明…" />
          <button class="btn-accept" onclick="submitFeedback(\${s.id}, 'accepted')">✓ 接受并写入改进记录</button>
          <button class="btn-reject" onclick="submitFeedback(\${s.id}, 'rejected')">✗ 忽略</button>
        </div>
      </div>
    \`).join('');
  } catch(e) {
    const el = document.getElementById('suggestions-list');
    if (el) el.innerHTML = '<div class="empty" style="color:var(--red)">加载失败: ' + e.message + '</div>';
  }
}

async function submitFeedback(id, feedback) {
  const noteEl = document.getElementById('note-' + id);
  const note = noteEl ? noteEl.value.trim() : '';
  try {
    const res = await fetch('/api/self-improvements/' + id + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, note: note || undefined }),
    });
    if (res.ok) {
      const card = document.getElementById('suggestion-' + id);
      if (card) {
        card.style.opacity = '0.4';
        card.style.pointerEvents = 'none';
        card.querySelector('.suggestion-actions').innerHTML =
          feedback === 'accepted'
            ? '<span style="color:var(--green);font-size:12px">✓ 已接受并写入 self-improvement.md</span>'
            : '<span style="color:var(--muted);font-size:12px">已忽略</span>';
      }
      // 延迟移除卡片
      setTimeout(() => { const c = document.getElementById('suggestion-' + id); if(c) c.remove(); }, 2000);
    }
  } catch(e) {
    alert('提交反馈失败: ' + e.message);
  }
}

refresh();
loadSuggestions();
setInterval(refresh, 5000);
setInterval(loadSuggestions, 10000);
</script>
</body>
</html>`;

/**
 * HTTP 状态服务器
 * GET  /              → Dashboard HTML（每 5s 自动刷新）
 * GET  /api/status    → JSON 状态数据
 * POST /api/test-alarm → 手动注入测试告警到队列
 */
export function startStatusServer(port = 3000, alarmQueue?: AlarmQueue) {
  const app = express();
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DASHBOARD_HTML);
  });

  app.get('/api/status', (_req, res) => {
    res.json(statusStore.get());
  });

  // GET /api/db/alarms?limit=50             最近 N 条
  // GET /api/db/alarms?start=...&end=...    按时间范围查询
  // GET /api/db/stats                       统计汇总
  app.get('/api/db/alarms', (_req, res) => {
    const { limit, start, end } = _req.query as Record<string, string | undefined>;
    let records;
    if (start && end) {
      records = queryAlarmsByRange(start, end);
    } else {
      records = queryRecentAlarms(limit ? parseInt(limit, 10) : 50);
    }
    res.json({ total: records.length, records });
  });

  app.get('/api/db/stats', (_req, res) => {
    res.json(queryStats());
  });

  // GET /api/llm-calls?limit=50&alarmId=xxx
  app.get('/api/llm-calls', (_req, res) => {
    const { limit, alarmId } = _req.query as Record<string, string | undefined>;
    let records;
    if (alarmId) {
      records = queryLlmCallsByAlarm(alarmId);
    } else {
      records = queryRecentLlmCalls(limit ? parseInt(limit, 10) : 50);
    }
    res.json({ total: records.length, records });
  });

  // GET /api/self-improvements?pending=true
  app.get('/api/self-improvements', (_req, res) => {
    const { pending } = _req.query as Record<string, string | undefined>;
    const records = pending === 'true'
      ? queryPendingSelfImprovements()
      : queryRecentSelfImprovements(50);
    res.json({ total: records.length, records });
  });

  // POST /api/self-improvements/:id/feedback  body: { feedback: 'accepted'|'rejected', note?: string }
  app.post('/api/self-improvements/:id/feedback', (req, res) => {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (isNaN(id)) {
      res.status(400).json({ error: 'id 必须为整数' });
      return;
    }
    const { feedback, note } = req.body as { feedback?: string; note?: string };
    if (feedback !== 'accepted' && feedback !== 'rejected') {
      res.status(400).json({ error: 'feedback 必须为 accepted 或 rejected' });
      return;
    }
    try {
      updateSelfImprovementFeedback(id, feedback, note);
      logger.info('StatusServer', '用户提交改进建议反馈', { id, feedback, hasNote: !!note });
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/test-alarm', (req, res) => {
    if (!alarmQueue) {
      res.status(503).json({ error: '告警队列尚未就绪' });
      return;
    }

    const { alarmType, faultCategory, deviceId, priority } = req.body as {
      alarmType?: string;
      faultCategory?: string;
      deviceId?: string;
      priority?: string;
    };

    if (!alarmType) {
      res.status(400).json({ error: 'alarmType 不能为空' });
      return;
    }

    const validCategories = ['hardware', 'software'];
    const validPriorities = ['P0', 'P1', 'P2', 'P3'];

    const alarm: Alarm = {
      alarmId:       `TEST-${Date.now()}`,
      alarmType:     alarmType.trim(),
      faultCategory: validCategories.includes(faultCategory ?? '') ? (faultCategory as 'hardware' | 'software') : 'software',
      deviceId:      (deviceId ?? 'unknown').trim() || 'unknown',
      timestamp:     new Date(Date.now() + 8 * 3600000).toISOString().replace('Z', '+08:00'),
      priority:      validPriorities.includes(priority ?? '') ? (priority as 'P0' | 'P1' | 'P2' | 'P3') : 'P2',
    };

    alarmQueue.push(alarm);

    logger.info('StatusServer', '手动注入测试告警', {
      alarmId: alarm.alarmId,
      alarmType: alarm.alarmType,
      faultCategory: alarm.faultCategory,
      deviceId: alarm.deviceId,
      priority: alarm.priority,
    });

    res.json({ ok: true, alarmId: alarm.alarmId });
  });

  app.listen(port, () => {
    logger.info('StatusServer', `状态面板已启动: http://localhost:${port}`);
  });
}
