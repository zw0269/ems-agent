import express from 'express';
import { statusStore } from './statusStore.js';

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
  @media (max-width: 768px) { .info-grid { grid-template-columns: 1fr; } }
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

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

/**
 * HTTP 状态服务器
 * GET /           → Dashboard HTML（每 5s 自动刷新）
 * GET /api/status → JSON 状态数据
 */
export function startStatusServer(port = 3000) {
  const app = express();

  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DASHBOARD_HTML);
  });

  app.get('/api/status', (_req, res) => {
    res.json(statusStore.get());
  });

  app.listen(port, () => {
    console.log(`[StatusServer] 状态面板已启动: http://localhost:${port}`);
  });
}
