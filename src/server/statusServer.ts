import express from 'express';
import { statusStore } from './statusStore.js';
import { queryRecentAlarms, queryAlarmsByRange, queryStats, queryAlarmById, queryAlarmTrend } from '../db/alarmRepository.js';
import { queryRecentLlmCalls, queryLlmCallsByAlarm, queryTokenStats } from '../db/llmCallRepository.js';
import {
  queryPendingSelfImprovements,
  queryRecentSelfImprovements,
  updateSelfImprovementFeedback,
} from '../db/selfImprovementRepository.js';
import { queryRealtimeSnapshotByAlarm } from '../db/realtimeSnapshotRepository.js';
import { queryRecentEmsAlarms } from '../db/emsAlarmRepository.js';
import type { AlarmQueue } from '../gateway/alarmQueue.js';
import type { Alarm } from '../types/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EMS Agent 监控面板</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0c14; --surface: #111320; --surface2: #181b2a; --border: #232640;
  --text: #e2e8f0; --muted: #5a6278; --accent: #6366f1; --accent2: #8b5cf6;
  --green: #22c55e; --red: #ef4444; --yellow: #f59e0b; --blue: #3b82f6; --cyan: #06b6d4;
}
body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', system-ui, sans-serif; font-size: 14px; min-height: 100vh; }

/* ── Header ── */
header {
  background: var(--surface); border-bottom: 1px solid var(--border);
  padding: 0 24px; display: flex; align-items: center; gap: 12px; height: 56px;
  position: sticky; top: 0; z-index: 100;
}
header h1 { font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
.badge { background: var(--accent); color: #fff; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; }
.header-right { margin-left: auto; display: flex; align-items: center; gap: 16px; }
.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.refresh-clock { color: var(--muted); font-size: 12px; }

/* ── Tab Nav ── */
.tab-nav {
  background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; padding: 0 24px; gap: 4px;
}
.tab-btn {
  padding: 12px 18px; font-size: 13px; font-weight: 500; cursor: pointer;
  border: none; background: none; color: var(--muted);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color .15s, border-color .15s;
}
.tab-btn:hover { color: var(--text); }
.tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }

/* ── Layout ── */
.page { padding: 24px; max-width: 1400px; margin: 0 auto; }

/* ── Stats Grid ── */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 24px; }
.stat-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 16px; position: relative; overflow: hidden;
}
.stat-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, var(--card-color, var(--accent)), transparent);
}
.stat-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
.stat-value { font-size: 30px; font-weight: 800; line-height: 1; }
.stat-sub { color: var(--muted); font-size: 12px; margin-top: 6px; }
.status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
.dot-green { background: var(--green); box-shadow: 0 0 6px var(--green); }
.dot-red   { background: var(--red);   box-shadow: 0 0 6px var(--red);   }
.dot-yellow{ background: var(--yellow);box-shadow: 0 0 6px var(--yellow); }
.dot-grey  { background: var(--muted); }

/* ── Info panels ── */
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
.panel {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 18px;
}
.panel-title { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase;
  letter-spacing: .08em; margin-bottom: 14px; }
.info-row { display: flex; justify-content: space-between; align-items: center;
  padding: 7px 0; border-bottom: 1px solid var(--border); }
.info-row:last-child { border-bottom: none; }
.info-label { color: var(--muted); }
.info-val { font-weight: 500; max-width: 55%; text-align: right; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }

/* ── Trend Chart ── */
.chart-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 18px; margin-bottom: 24px; }
.chart-wrap svg { display: block; width: 100%; height: 120px; }

/* ── Table ── */
.table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-bottom: 24px; }
table { width: 100%; border-collapse: collapse; }
thead { background: #0d0f1c; }
th { padding: 10px 14px; text-align: left; color: var(--muted); font-size: 11px;
  text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
td { padding: 10px 14px; border-top: 1px solid var(--border); vertical-align: middle; }
tr.clickable { cursor: pointer; }
tr.clickable:hover td { background: rgba(99,102,241,.06); }
.tag { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
.tag-p0 { background: rgba(239,68,68,.15); color: var(--red); }
.tag-p1 { background: rgba(245,158,11,.15); color: var(--yellow); }
.tag-p2 { background: rgba(59,130,246,.15); color: var(--blue); }
.tag-p3 { background: rgba(107,114,128,.15); color: var(--muted); }
.tag-done { background: rgba(34,197,94,.15); color: var(--green); }
.tag-error { background: rgba(239,68,68,.15); color: var(--red); }
.tag-processing { background: rgba(99,102,241,.15); color: var(--accent); animation: blink 1.5s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.5} }
.mono { font-family: 'Cascadia Code','Consolas',monospace; font-size: 12px; }
.muted { color: var(--muted); font-size: 12px; }
.empty { text-align: center; color: var(--muted); padding: 40px; }
.conclusion-cell { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 12px; }

/* ── Filter bar ── */
.filter-bar { display: flex; gap: 10px; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.filter-bar input, .filter-bar select {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 7px 12px; font-size: 13px; outline: none;
}
.filter-bar input:focus, .filter-bar select:focus { border-color: var(--accent); }
.btn { border: 1px solid var(--border); border-radius: 8px; padding: 7px 16px;
  font-size: 13px; font-weight: 500; cursor: pointer; transition: all .15s; }
.btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn-primary:hover { opacity: .85; }
.btn-ghost { background: transparent; color: var(--text); }
.btn-ghost:hover { background: var(--surface2); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.pager { display: flex; gap: 8px; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border); }
.pager-info { color: var(--muted); font-size: 12px; }

/* ── Test panel ── */
.test-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 24px; }
.test-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 12px; align-items: end; margin-top: 14px; }
.form-group { display: flex; flex-direction: column; gap: 6px; }
.form-group label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
.form-group input, .form-group select {
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 8px 12px; font-size: 13px; outline: none;
}
.form-group input:focus, .form-group select:focus { border-color: var(--accent); }
.test-result { margin-top: 12px; padding: 10px 14px; border-radius: 8px; font-size: 12px; display: none; }
.test-result.ok  { background: rgba(34,197,94,.08); color: var(--green); border: 1px solid rgba(34,197,94,.25); }
.test-result.err { background: rgba(239,68,68,.08); color: var(--red);   border: 1px solid rgba(239,68,68,.25); }

/* ── Suggestion cards ── */
.suggestion-card { background: var(--surface2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; margin-bottom: 10px; }
.suggestion-meta { color: var(--muted); font-size: 11px; margin-bottom: 8px; }
.suggestion-text { font-size: 13px; line-height: 1.75; white-space: pre-wrap; margin-bottom: 10px; }
.suggestion-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.btn-accept { background: rgba(34,197,94,.12); color: var(--green); border: 1px solid rgba(34,197,94,.3); border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; font-weight: 600; }
.btn-reject { background: rgba(239,68,68,.08); color: var(--red); border: 1px solid rgba(239,68,68,.25); border-radius: 6px; padding: 5px 14px; cursor: pointer; font-size: 12px; }
.btn-accept:hover { background: rgba(34,197,94,.25); }
.btn-reject:hover { background: rgba(239,68,68,.2); }
.suggestion-note { flex: 1; min-width: 160px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 5px 10px; font-size: 12px; outline: none; }

/* ── Log viewer ── */
.log-container {
  background: #070911; border: 1px solid var(--border); border-radius: 10px;
  font-family: 'Cascadia Code','Consolas',monospace; font-size: 12px;
  height: 580px; overflow-y: auto; padding: 12px 16px;
}
.log-line { padding: 2px 0; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }
.log-INFO  { color: #94a3b8; }
.log-WARN  { color: var(--yellow); }
.log-ERROR { color: var(--red); }
.log-kw    { background: rgba(245,158,11,.25); color: var(--yellow); border-radius: 2px; padding: 0 2px; }
.log-stats { color: var(--muted); font-size: 12px; padding: 8px 0; }

/* ── Modal ── */
.modal-overlay {
  display: none; position: fixed; inset: 0; background: rgba(0,0,0,.72);
  z-index: 1000; align-items: flex-start; justify-content: center;
  padding: 32px 16px; overflow-y: auto;
}
.modal-overlay.open { display: flex; }
.modal {
  background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
  width: 100%; max-width: 900px; overflow: hidden;
}
.modal-header {
  display: flex; align-items: center; padding: 18px 24px;
  border-bottom: 1px solid var(--border); gap: 12px;
}
.modal-title { font-size: 15px; font-weight: 700; }
.modal-close { margin-left: auto; background: none; border: none; color: var(--muted); cursor: pointer; font-size: 20px; line-height: 1; }
.modal-close:hover { color: var(--text); }
.modal-body { padding: 24px; }
.modal-section { margin-bottom: 24px; }
.modal-section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 12px; }
.conclusion-box {
  background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
  padding: 16px; font-size: 13px; line-height: 1.8; white-space: pre-wrap;
  max-height: 300px; overflow-y: auto;
}
.llm-call-item {
  background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
  margin-bottom: 8px; overflow: hidden;
}
.llm-call-header {
  display: flex; align-items: center; padding: 10px 14px; gap: 10px;
  cursor: pointer; user-select: none;
}
.llm-call-header:hover { background: rgba(255,255,255,.03); }
.llm-call-type { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
.type-final { background: rgba(34,197,94,.15); color: var(--green); }
.type-tool { background: rgba(59,130,246,.15); color: var(--blue); }
.type-other { background: rgba(107,114,128,.15); color: var(--muted); }
.llm-call-body { display: none; padding: 12px 14px; border-top: 1px solid var(--border); }
.llm-call-body.open { display: block; }
.llm-call-body pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; color: #94a3b8; line-height: 1.6; max-height: 250px; overflow-y: auto; }
.snapshot-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px; }
.snapshot-item { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.snapshot-key { color: var(--muted); font-size: 11px; margin-bottom: 4px; }
.snapshot-val { font-size: 14px; font-weight: 600; }
.snapshot-val.alert { color: var(--red); }

@media (max-width: 768px) { .row2 { grid-template-columns: 1fr; } .stats-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>

<header>
  <div id="live-dot" class="live-dot"></div>
  <h1>EMS Agent 监控面板</h1>
  <span class="badge">v2.0</span>
  <div class="header-right">
    <span class="refresh-clock" id="refresh-clock">--:--:--</span>
  </div>
</header>

<nav class="tab-nav">
  <button class="tab-btn active" onclick="switchTab('overview')">概览</button>
  <button class="tab-btn" onclick="switchTab('alarms')">历史告警</button>
  <button class="tab-btn" onclick="switchTab('logs')">运行日志</button>
  <button class="tab-btn" onclick="switchTab('ai')">AI 改进建议</button>
</nav>

<!-- ════════════════ TAB: 概览 ════════════════ -->
<div id="tab-overview" class="tab-panel active">
<div class="page">
  <div class="stats-grid" id="stats-grid"></div>

  <!-- 告警趋势图 -->
  <div class="chart-wrap">
    <div class="panel-title" style="margin-bottom:10px">24 小时告警趋势</div>
    <svg id="trend-svg" viewBox="0 0 800 120" preserveAspectRatio="none"></svg>
  </div>

  <div class="row2">
    <div class="panel">
      <div class="panel-title">LLM 配置</div>
      <div id="llm-info"></div>
    </div>
    <div class="panel">
      <div class="panel-title">心跳 / 轮询</div>
      <div id="heartbeat-info"></div>
    </div>
  </div>

  <!-- 测试告警注入 -->
  <div class="test-panel">
    <div class="panel-title" style="color:var(--yellow)">🧪 手动注入测试告警</div>
    <div class="test-form">
      <div class="form-group">
        <label>告警类型</label>
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
        <input id="f-device" type="text" value="Pcs" />
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
        <button class="btn btn-primary" id="btn-inject" onclick="injectAlarm()">注入告警</button>
      </div>
    </div>
    <div class="test-result" id="test-result"></div>
  </div>

  <!-- 当前处理中告警（实时） -->
  <div class="panel-title">实时处理状态</div>
  <div class="table-wrap" style="margin-top:12px">
    <table>
      <thead><tr><th>告警 ID</th><th>类型</th><th>优先级</th><th>状态</th><th>开始时间</th><th>耗时</th><th>结论摘要</th></tr></thead>
      <tbody id="realtime-tbody"></tbody>
    </table>
  </div>
</div>
</div>

<!-- ════════════════ TAB: 历史告警 ════════════════ -->
<div id="tab-alarms" class="tab-panel">
<div class="page">
  <div class="table-wrap">
    <div class="filter-bar">
      <select id="h-status" onchange="loadHistory()">
        <option value="">全部状态</option>
        <option value="done">完成</option>
        <option value="error">错误</option>
        <option value="processing">处理中</option>
      </select>
      <select id="h-priority" onchange="loadHistory()">
        <option value="">全部优先级</option>
        <option value="P0">P0</option><option value="P1">P1</option>
        <option value="P2">P2</option><option value="P3">P3</option>
      </select>
      <input id="h-keyword" type="text" placeholder="关键词搜索…" style="width:180px" />
      <button class="btn btn-primary" onclick="loadHistory()">搜索</button>
      <span id="h-total" class="muted" style="margin-left:auto"></span>
    </div>
    <table>
      <thead>
        <tr><th>#</th><th>告警 ID</th><th>类型</th><th>设备</th><th>优先级</th><th>状态</th><th>耗时</th><th>时间</th><th>结论</th></tr>
      </thead>
      <tbody id="history-tbody"></tbody>
    </table>
    <div class="pager">
      <button class="btn btn-ghost" id="h-prev" onclick="historyPage(-1)">← 上一页</button>
      <span class="pager-info" id="h-page-info"></span>
      <button class="btn btn-ghost" id="h-next" onclick="historyPage(1)">下一页 →</button>
    </div>
  </div>

  <!-- EMS 告警（来自 Agent 工具查询） -->
  <div class="panel" style="margin-top:20px">
    <div class="panel-title" style="display:flex;align-items:center;justify-content:space-between">
      <span>🔍 Agent 工具查询的 EMS 告警</span>
      <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="loadEmsAlarms()">刷新</button>
    </div>
    <div class="table-wrap" style="margin-top:8px">
      <table>
        <thead><tr><th>EMS ID</th><th>告警名称</th><th>级别</th><th>设备类型</th><th>告警时间</th><th>恢复时间</th><th>来源</th><th>关联 Agent 告警</th></tr></thead>
        <tbody id="ems-alarms-tbody"><tr><td colspan="8" class="empty">加载中…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>
</div>

<!-- ════════════════ TAB: 日志 ════════════════ -->
<div id="tab-logs" class="tab-panel">
<div class="page">
  <div class="panel" style="margin-bottom:16px">
    <div class="filter-bar" style="padding:0;border:none;margin-bottom:12px">
      <select id="log-date" onchange="loadLogs()"></select>
      <select id="log-level" onchange="loadLogs()">
        <option value="">全部级别</option>
        <option value="INFO">INFO</option>
        <option value="WARN">WARN</option>
        <option value="ERROR">ERROR</option>
      </select>
      <input id="log-kw" type="text" placeholder="关键词高亮…" style="width:180px" />
      <button class="btn btn-primary" onclick="loadLogs()">刷新</button>
      <label style="display:flex;align-items:center;gap:6px;color:var(--muted);font-size:12px;cursor:pointer">
        <input type="checkbox" id="log-auto" checked onchange="toggleLogAuto()" /> 自动刷新
      </label>
      <span id="log-stats" class="muted" style="margin-left:auto"></span>
    </div>
    <div class="log-container" id="log-container"></div>
  </div>
</div>
</div>

<!-- ════════════════ TAB: AI 改进 ════════════════ -->
<div id="tab-ai" class="tab-panel">
<div class="page">
  <div class="panel" style="border-color:rgba(99,102,241,.3); margin-bottom:24px">
    <div class="panel-title" style="color:var(--accent)">💡 待处理改进建议</div>
    <div id="suggestions-list"><div class="empty">加载中…</div></div>
  </div>
  <div class="panel" style="margin-bottom:24px">
    <div class="panel-title">历史建议记录</div>
    <div id="suggestions-history"><div class="empty">加载中…</div></div>
  </div>
</div>
</div>

<!-- ════════════════ 告警详情 Modal ════════════════ -->
<div class="modal-overlay" id="modal-overlay" onclick="closeModal(event)">
  <div class="modal" id="modal-box">
    <div class="modal-header">
      <div>
        <div class="modal-title" id="modal-title">告警详情</div>
        <div class="muted" id="modal-sub" style="font-size:12px;margin-top:2px"></div>
      </div>
      <button class="modal-close" onclick="closeModalBtn()">✕</button>
    </div>
    <div class="modal-body" id="modal-body">
      <div class="empty">加载中…</div>
    </div>
  </div>
</div>

<script>
// ══════════════════════════════════════════════════
//  工具函数
// ══════════════════════════════════════════════════
function fmt(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('zh-CN', {hour12:false}); } catch { return iso; }
}
function fmtDur(ms) {
  if (ms == null || ms === undefined) return '-';
  if (ms < 1000) return ms + 'ms';
  return (ms/1000).toFixed(1) + 's';
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function pTag(p) {
  return '<span class="tag tag-' + (p||'p2').toLowerCase() + '">' + esc(p) + '</span>';
}
function sTag(s) {
  const m = {done:'完成',error:'错误',processing:'处理中'};
  return '<span class="tag tag-' + s + '">' + (m[s]||s) + '</span>';
}
function fmtNum(n) {
  if (n == null) return '0';
  return Number(n).toLocaleString();
}

// ══════════════════════════════════════════════════
//  Tab 切换
// ══════════════════════════════════════════════════
let _currentTab = 'overview';
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => {
    const tabs = ['overview','alarms','logs','ai'];
    b.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  _currentTab = tab;
  if (tab === 'alarms') { if (_historyData.length === 0) loadHistory(); loadEmsAlarms(); }
  if (tab === 'logs') loadLogs();
  if (tab === 'ai') { loadSuggestions(); loadSuggestionsHistory(); }
}

// ══════════════════════════════════════════════════
//  概览 Tab
// ══════════════════════════════════════════════════
async function refreshOverview() {
  try {
    const [statusRes, tokenRes, trendRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/db/token-stats'),
      fetch('/api/db/alarm-trend'),
    ]);
    const d  = await statusRes.json();
    const tk = await tokenRes.json();
    const tr = await trendRes.json();

    const apiColor = d.llmApiOk===true?'green':d.llmApiOk===false?'red':'grey';
    const apiText  = d.llmApiOk===true?'已连通':d.llmApiOk===false?'连接失败':'未测试';
    document.getElementById('stats-grid').innerHTML = \`
      <div class="stat-card" style="--card-color:var(--green)">
        <div class="stat-label">API 状态</div>
        <div class="stat-value" style="font-size:18px;margin-top:6px"><span class="status-dot dot-\${apiColor}"></span>\${apiText}</div>
        <div class="stat-sub">\${esc(d.llmProvider)} · \${esc(d.llmModel)}</div>
      </div>
      <div class="stat-card" style="--card-color:var(--blue)">
        <div class="stat-label">队列待处理</div>
        <div class="stat-value">\${d.queueLength}</div>
        <div class="stat-sub">告警等待分析</div>
      </div>
      <div class="stat-card" style="--card-color:var(--accent)">
        <div class="stat-label">活跃会话</div>
        <div class="stat-value">\${d.activeSessionCount}</div>
        <div class="stat-sub">Agent 正在分析</div>
      </div>
      <div class="stat-card" style="--card-color:var(--green)">
        <div class="stat-label">累计成功</div>
        <div class="stat-value">\${d.totalProcessed}</div>
        <div class="stat-sub">错误 \${d.totalErrors} 次</div>
      </div>
      <div class="stat-card" style="--card-color:var(--cyan)">
        <div class="stat-label">今日 Token</div>
        <div class="stat-value" style="font-size:20px">\${fmtNum(tk.todayInput+tk.todayOutput)}</div>
        <div class="stat-sub">↑\${fmtNum(tk.todayInput)} ↓\${fmtNum(tk.todayOutput)} · \${tk.todayCalls}次调用</div>
      </div>
      <div class="stat-card" style="--card-color:var(--accent2)">
        <div class="stat-label">累计 Token</div>
        <div class="stat-value" style="font-size:20px">\${fmtNum(tk.totalInput+tk.totalOutput)}</div>
        <div class="stat-sub">共 \${tk.totalCalls} 次 LLM 调用</div>
      </div>
      <div class="stat-card" style="--card-color:var(--yellow)">
        <div class="stat-label">启动时间</div>
        <div class="stat-value" style="font-size:13px;margin-top:8px">\${fmt(d.startedAt)}</div>
        <div class="stat-sub">Agent 持续运行中</div>
      </div>
    \`;

    // 趋势折线图
    drawTrend(tr.trend || []);

    // LLM 信息
    document.getElementById('llm-info').innerHTML = \`
      <div class="info-row"><span class="info-label">Provider</span><span class="info-val">\${esc(d.llmProvider)}</span></div>
      <div class="info-row"><span class="info-label">Model</span><span class="info-val">\${esc(d.llmModel)}</span></div>
      <div class="info-row"><span class="info-label">Base URL</span><span class="info-val" title="\${esc(d.llmBaseUrl)}">\${esc(d.llmBaseUrl)}</span></div>
      <div class="info-row"><span class="info-label">API 连通</span><span class="info-val"><span class="status-dot dot-\${apiColor}"></span>\${apiText}</span></div>
    \`;

    // 心跳信息
    const hb = d.lastHeartbeat;
    document.getElementById('heartbeat-info').innerHTML = hb ? \`
      <div class="info-row"><span class="info-label">最后轮询</span><span class="info-val">\${fmt(hb.time)}</span></div>
      <div class="info-row"><span class="info-label">本次告警数</span><span class="info-val">\${hb.alarmCount}</span></div>
      <div class="info-row"><span class="info-label">状态</span><span class="info-val"><span class="status-dot dot-\${hb.ok?'green':'red'}"></span>\${hb.ok?'正常':'失败'}</span></div>
      \${hb.error?'<div class="info-row"><span class="info-label">错误</span><span class="info-val" style="color:var(--red)">'+esc(hb.error)+'</span></div>':''}
    \` : '<div class="empty">尚未触发轮询</div>';

    // 实时告警表格（内存数据）
    const tbody = document.getElementById('realtime-tbody');
    if (!d.recentAlarms.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无告警记录</td></tr>';
    } else {
      tbody.innerHTML = d.recentAlarms.map(a => \`
        <tr class="clickable" onclick="openModal('\${esc(a.alarmId)}')">
          <td class="mono">\${esc(a.alarmId)}</td>
          <td>\${esc(a.alarmType)}</td>
          <td>\${pTag(a.priority)}</td>
          <td>\${sTag(a.status)}</td>
          <td class="muted">\${fmt(a.startedAt)}</td>
          <td class="muted">\${fmtDur(a.durationMs)}</td>
          <td><div class="conclusion-cell">\${esc(a.conclusion||'-')}</div></td>
        </tr>
      \`).join('');
    }

    document.getElementById('refresh-clock').textContent = new Date().toLocaleTimeString('zh-CN',{hour12:false});
    document.getElementById('live-dot').style.background = 'var(--green)';
  } catch(e) {
    document.getElementById('live-dot').style.background = 'var(--red)';
  }
}

// ── 趋势折线图（纯 SVG） ──
function drawTrend(points) {
  const svg = document.getElementById('trend-svg');
  if (!points || !points.length) { svg.innerHTML = '<text x="50%" y="60" text-anchor="middle" fill="#5a6278" font-size="13">暂无数据</text>'; return; }

  const W = 800, H = 120, PAD = { top: 10, bottom: 28, left: 10, right: 10 };
  const maxVal = Math.max(...points.map(p => p.count), 1);
  const n = points.length;
  const xStep = (W - PAD.left - PAD.right) / Math.max(n - 1, 1);
  const yScale = (H - PAD.top - PAD.bottom) / maxVal;

  const pts = points.map((p, i) => ({
    x: PAD.left + i * xStep,
    y: H - PAD.bottom - p.count * yScale,
    count: p.count,
    hour: p.hour,
  }));

  const polyline = pts.map(p => p.x + ',' + p.y).join(' ');
  const area = 'M' + pts[0].x + ',' + (H - PAD.bottom) +
    ' L' + pts.map(p => p.x + ',' + p.y).join(' L') +
    ' L' + pts[pts.length-1].x + ',' + (H - PAD.bottom) + ' Z';

  // 仅展示部分 X 轴标签，避免拥挤
  const labelStep = n <= 12 ? 1 : n <= 24 ? 2 : 4;
  const labels = pts
    .filter((_, i) => i % labelStep === 0 || i === n-1)
    .map(p => \`<text x="\${p.x}" y="\${H-6}" text-anchor="middle" fill="#5a6278" font-size="9">\${p.hour}</text>\`)
    .join('');

  // 数据点 tooltip（title）
  const circles = pts.filter(p => p.count > 0).map(p =>
    \`<circle cx="\${p.x}" cy="\${p.y}" r="3" fill="var(--accent)" stroke="var(--bg)" stroke-width="1.5"><title>\${p.hour}: \${p.count} 条告警</title></circle>\`
  ).join('');

  svg.innerHTML = \`
    <defs>
      <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity=".35"/>
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="\${area}" fill="url(#tg)"/>
    <polyline points="\${polyline}" fill="none" stroke="#6366f1" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    \${circles}
    \${labels}
  \`;
}

// ── 手动注入告警 ──
async function injectAlarm() {
  const btn = document.getElementById('btn-inject');
  const alarmType = document.getElementById('f-type').value.trim();
  if (!alarmType) { showInjectResult('err', '告警类型不能为空'); return; }
  btn.disabled = true; btn.textContent = '注入中…';
  document.getElementById('test-result').style.display = 'none';
  try {
    const res = await fetch('/api/test-alarm', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        alarmType,
        faultCategory: document.getElementById('f-category').value,
        deviceId:  document.getElementById('f-device').value.trim() || 'unknown',
        priority:  document.getElementById('f-priority').value,
      }),
    });
    const data = await res.json();
    if (res.ok) showInjectResult('ok', '✓ 已注入队列，alarmId: ' + data.alarmId);
    else        showInjectResult('err', '✗ ' + (data.error||'注入失败'));
  } catch(e) { showInjectResult('err', '✗ 网络错误: ' + e.message); }
  finally { btn.disabled=false; btn.textContent='注入告警'; }
}
function showInjectResult(type, msg) {
  const el = document.getElementById('test-result');
  el.className = 'test-result ' + (type==='ok'?'ok':'err');
  el.textContent = msg; el.style.display = 'block';
}

// ══════════════════════════════════════════════════
//  历史告警 Tab
// ══════════════════════════════════════════════════
let _historyData = [], _hPage = 0, _hPageSize = 20;

async function loadHistory() {
  _hPage = 0;
  const kw = document.getElementById('h-keyword').value.toLowerCase();
  const status = document.getElementById('h-status').value;
  const priority = document.getElementById('h-priority').value;

  try {
    const res = await fetch('/api/db/alarms?limit=500');
    const d = await res.json();
    let records = d.records || [];
    if (status)   records = records.filter(r => r.status === status);
    if (priority) records = records.filter(r => r.priority === priority);
    if (kw)       records = records.filter(r =>
      (r.alarm_type||'').toLowerCase().includes(kw) ||
      (r.alarm_id||'').toLowerCase().includes(kw) ||
      (r.conclusion||'').toLowerCase().includes(kw)
    );
    _historyData = records;
    document.getElementById('h-total').textContent = '共 ' + records.length + ' 条';
    renderHistoryPage();
  } catch(e) {
    document.getElementById('history-tbody').innerHTML = '<tr><td colspan="9" class="empty" style="color:var(--red)">加载失败: '+esc(e.message)+'</td></tr>';
  }
}

function renderHistoryPage() {
  const start = _hPage * _hPageSize;
  const page = _historyData.slice(start, start + _hPageSize);
  const tbody = document.getElementById('history-tbody');
  if (!_historyData.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">暂无记录</td></tr>';
  } else {
    tbody.innerHTML = page.map((r, i) => \`
      <tr class="clickable" onclick="openModal('\${esc(r.alarm_id)}')">
        <td class="muted">\${start+i+1}</td>
        <td class="mono">\${esc(r.alarm_id)}</td>
        <td>\${esc(r.alarm_type)}</td>
        <td class="muted">\${esc(r.device_id)}</td>
        <td>\${pTag(r.priority)}</td>
        <td>\${sTag(r.status)}</td>
        <td class="muted">\${fmtDur(r.duration_ms)}</td>
        <td class="muted">\${fmt(r.started_at)}</td>
        <td><div class="conclusion-cell">\${esc(r.conclusion||'-')}</div></td>
      </tr>
    \`).join('');
  }
  const total = _historyData.length;
  const pages = Math.ceil(total / _hPageSize) || 1;
  document.getElementById('h-page-info').textContent = '第 ' + (_hPage+1) + ' / ' + pages + ' 页';
  document.getElementById('h-prev').disabled = _hPage === 0;
  document.getElementById('h-next').disabled = _hPage >= pages - 1;
}

function historyPage(dir) {
  const pages = Math.ceil(_historyData.length / _hPageSize) || 1;
  _hPage = Math.max(0, Math.min(pages-1, _hPage + dir));
  renderHistoryPage();
}

// ══════════════════════════════════════════════════
//  告警详情 Modal
// ══════════════════════════════════════════════════
async function openModal(alarmId) {
  document.getElementById('modal-title').textContent = alarmId;
  document.getElementById('modal-sub').textContent = '加载中…';
  document.getElementById('modal-body').innerHTML = '<div class="empty">加载中…</div>';
  document.getElementById('modal-overlay').classList.add('open');

  try {
    const res = await fetch('/api/db/alarm-detail/' + encodeURIComponent(alarmId));
    const d = await res.json();
    const alarm = d.alarm;
    if (!alarm) { document.getElementById('modal-body').innerHTML = '<div class="empty">记录不存在</div>'; return; }

    document.getElementById('modal-sub').textContent =
      alarm.alarm_type + ' · ' + alarm.priority + ' · ' + fmt(alarm.started_at);

    // ── 结论 ──
    const conclusionHtml = alarm.conclusion
      ? \`<div class="conclusion-box">\${esc(alarm.conclusion)}</div>\`
      : \`<div class="muted">（暂无结论）</div>\`;

    // ── 基本信息 ──
    const infoHtml = \`
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:4px">
        \${[
          ['告警 ID', alarm.alarm_id],
          ['类型', alarm.alarm_type],
          ['设备', alarm.device_id],
          ['优先级', alarm.priority],
          ['状态', alarm.status],
          ['耗时', fmtDur(alarm.duration_ms)],
          ['开始时间', fmt(alarm.started_at)],
          ['结束时间', fmt(alarm.finished_at)],
          ['类别', alarm.fault_category],
          ['是否测试', alarm.is_test ? '是' : '否'],
        ].map(([k,v]) => \`<div class="snapshot-item"><div class="snapshot-key">\${k}</div><div class="snapshot-val" style="font-size:13px">\${esc(v)}</div></div>\`).join('')}
      </div>
    \`;

    // ── 实时快照 ──
    let snapshotHtml = '<div class="muted">无快照数据</div>';
    if (d.snapshot) {
      const IMPORTANT_KEYS = ['batterySOC','batteryVoltage','gridFrequency','pcsInsulationresistance',
        'pcsLeakageCurrent','bmsActiveAlarms','pcsActiveFaults','pcsActiveAlarms','timestamp','deviceId'];
      const entries = Object.entries(d.snapshot);
      const sorted = [
        ...entries.filter(([k]) => IMPORTANT_KEYS.includes(k)),
        ...entries.filter(([k]) => !IMPORTANT_KEYS.includes(k)),
      ];
      snapshotHtml = '<div class="snapshot-grid">' +
        sorted.slice(0, 30).map(([k, v]) => {
          const val = Array.isArray(v) ? (v.length ? v.join(', ') : '无') : String(v ?? '-');
          const isAlert = Array.isArray(v) && v.length > 0 && (k.includes('Active') || k.includes('Fault'));
          return \`<div class="snapshot-item">
            <div class="snapshot-key">\${esc(k)}</div>
            <div class="snapshot-val \${isAlert?'alert':''}">\${esc(val)}</div>
          </div>\`;
        }).join('') + '</div>';
    }

    // ── LLM 调用链 ──
    let llmHtml = '<div class="muted">无 LLM 调用记录</div>';
    if (d.llmCalls && d.llmCalls.length) {
      llmHtml = d.llmCalls.map((c, idx) => {
        let output;
        try { output = JSON.parse(c.output_json); } catch { output = {}; }
        const typeClass = output.type==='final_answer'?'type-final':output.type==='tool_call'?'type-tool':'type-other';
        const typeLabel = output.type==='final_answer'?'最终结论':output.type==='tool_call'?('工具: '+esc(output.toolName||'?')):'推理';
        return \`
          <div class="llm-call-item">
            <div class="llm-call-header" onclick="toggleLlmCall(\${idx})">
              <span class="muted" style="font-size:11px">轮次 \${c.call_index+1}</span>
              <span class="llm-call-type \${typeClass}">\${typeLabel}</span>
              <span class="muted" style="font-size:11px">\${c.input_tokens}↑ \${c.output_tokens}↓ tokens · \${fmtDur(c.duration_ms)}</span>
              <span style="margin-left:auto;color:var(--muted);font-size:13px" id="llm-chevron-\${idx}">›</span>
            </div>
            <div class="llm-call-body" id="llm-body-\${idx}">
              \${output.type==='tool_call' ? \`<div style="margin-bottom:8px;color:var(--blue);font-size:12px">调用参数: <code>\${esc(JSON.stringify(output.args||{}))}</code></div>\` : ''}
              \${output.text ? \`<div style="margin-bottom:8px;font-size:12px;color:var(--muted)">输出文本:</div><pre>\${esc(output.text)}</pre>\` : ''}
            </div>
          </div>
        \`;
      }).join('');
    }

    document.getElementById('modal-body').innerHTML = \`
      <div class="modal-section">
        <div class="modal-section-title">基本信息</div>
        \${infoHtml}
      </div>
      <div class="modal-section">
        <div class="modal-section-title">分析结论</div>
        \${conclusionHtml}
      </div>
      <div class="modal-section">
        <div class="modal-section-title">LLM 调用链（\${d.llmCalls.length} 轮）</div>
        \${llmHtml}
      </div>
      <div class="modal-section">
        <div class="modal-section-title">实时数据快照 \${d.capturedAt ? '· ' + fmt(d.capturedAt) : ''}</div>
        \${snapshotHtml}
      </div>
    \`;
  } catch(e) {
    document.getElementById('modal-body').innerHTML = '<div class="empty" style="color:var(--red)">加载失败: ' + esc(e.message) + '</div>';
  }
}

function toggleLlmCall(idx) {
  const body = document.getElementById('llm-body-' + idx);
  const chev = document.getElementById('llm-chevron-' + idx);
  if (body) body.classList.toggle('open');
  if (chev) chev.textContent = body.classList.contains('open') ? '⌄' : '›';
}

function closeModal(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModalBtn();
}
function closeModalBtn() {
  document.getElementById('modal-overlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key==='Escape') closeModalBtn(); });

// ══════════════════════════════════════════════════
//  日志查看器 Tab
// ══════════════════════════════════════════════════
let _logAutoTimer = null;

function toggleLogAuto() {
  const checked = document.getElementById('log-auto').checked;
  if (!checked && _logAutoTimer) { clearInterval(_logAutoTimer); _logAutoTimer = null; }
  else if (checked && !_logAutoTimer) { _logAutoTimer = setInterval(loadLogs, 8000); }
}

async function loadLogs() {
  const date  = document.getElementById('log-date').value;
  const level = document.getElementById('log-level').value;
  const kw    = document.getElementById('log-kw').value.trim();
  const params = new URLSearchParams({ lines: '600' });
  if (date)  params.set('date', date);
  if (level) params.set('level', level);
  if (kw)    params.set('keyword', kw);

  try {
    const res = await fetch('/api/logs?' + params);
    const d = await res.json();

    // 更新日期选项（如果有新的）
    const sel = document.getElementById('log-date');
    if (d.availableDates && d.availableDates.length) {
      const cur = sel.value;
      sel.innerHTML = d.availableDates.map(dt =>
        \`<option value="\${dt}" \${dt===cur?'selected':''}>\${dt}</option>\`
      ).join('');
      if (!cur && d.availableDates.length) sel.value = d.availableDates[0];
    }

    document.getElementById('log-stats').textContent = '共 ' + d.total + ' 行（显示最新 ' + d.lines.length + ' 行）';

    const container = document.getElementById('log-container');
    if (!d.lines || !d.lines.length) {
      container.innerHTML = '<div class="muted" style="padding:20px">该日期无日志</div>';
      return;
    }

    container.innerHTML = d.lines.map(line => {
      let cls = 'log-INFO';
      if (line.includes('[WARN ')) cls = 'log-WARN';
      else if (line.includes('[ERROR')) cls = 'log-ERROR';

      let html = esc(line);
      if (kw) {
        const re = new RegExp(esc(kw).replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&'), 'gi');
        html = html.replace(re, m => '<span class="log-kw">'+m+'</span>');
      }
      return '<div class="log-line ' + cls + '">' + html + '</div>';
    }).join('');

    // 自动滚动到底部
    container.scrollTop = container.scrollHeight;
  } catch(e) {
    document.getElementById('log-container').innerHTML = '<div class="muted" style="color:var(--red)">加载失败: ' + esc(e.message) + '</div>';
  }
}

// ══════════════════════════════════════════════════
//  AI 改进建议 Tab
// ══════════════════════════════════════════════════
async function loadSuggestions() {
  try {
    const res = await fetch('/api/self-improvements?pending=true');
    const d = await res.json();
    const el = document.getElementById('suggestions-list');
    if (!d.records || !d.records.length) {
      el.innerHTML = '<div class="empty">暂无待处理建议</div>';
      return;
    }
    el.innerHTML = d.records.map(s => \`
      <div class="suggestion-card" id="suggestion-\${s.id}">
        <div class="suggestion-meta">告警 ID: <strong>\${esc(s.alarm_id)}</strong> · \${fmt(s.created_at)}</div>
        <div class="suggestion-text">\${esc(s.suggestion_text)}</div>
        <div class="suggestion-actions">
          <input class="suggestion-note" id="note-\${s.id}" type="text" placeholder="可选：添加备注…" />
          <button class="btn-accept" onclick="submitFeedback(\${s.id},'accepted')">✓ 接受</button>
          <button class="btn-reject" onclick="submitFeedback(\${s.id},'rejected')">✗ 忽略</button>
        </div>
      </div>
    \`).join('');
  } catch(e) {
    document.getElementById('suggestions-list').innerHTML = '<div class="empty" style="color:var(--red)">加载失败: '+esc(e.message)+'</div>';
  }
}

async function loadSuggestionsHistory() {
  try {
    const res = await fetch('/api/self-improvements?pending=false');
    const d = await res.json();
    const el = document.getElementById('suggestions-history');
    const handled = (d.records||[]).filter(r => r.user_feedback !== null);
    if (!handled.length) { el.innerHTML = '<div class="empty">暂无历史记录</div>'; return; }
    // 存储完整建议文本供弹窗使用
    handled.forEach(r => { _suggestionTexts[r.id] = r.suggestion_text || ''; });
    el.innerHTML = '<div class="table-wrap"><table>' +
      '<thead><tr><th>时间</th><th>告警</th><th>反馈</th><th>建议摘要（点击查看全文）</th></tr></thead><tbody>' +
      handled.slice(0, 30).map(r => {
        const fb = r.user_feedback === 'accepted'
          ? '<span class="tag tag-done">已接受</span>'
          : '<span class="tag tag-error">已忽略</span>';
        const preview = esc((r.suggestion_text||'').slice(0,100)) + ((r.suggestion_text||'').length > 100 ? '…' : '');
        return \`<tr><td class="muted">\${fmt(r.created_at)}</td><td class="mono">\${esc(r.alarm_id)}</td><td>\${fb}</td>
          <td style="max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:var(--blue)" onclick="showSuggestionModal(\${r.id})" title="点击查看完整内容">\${preview}</td></tr>\`;
      }).join('') +
      '</tbody></table></div>';
  } catch { }
}

async function submitFeedback(id, feedback) {
  const note = (document.getElementById('note-'+id)||{}).value || '';
  try {
    const res = await fetch('/api/self-improvements/'+id+'/feedback', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ feedback, note: note || undefined }),
    });
    if (res.ok) {
      const card = document.getElementById('suggestion-'+id);
      if (card) {
        card.style.opacity = '.4';
        card.style.pointerEvents = 'none';
        card.querySelector('.suggestion-actions').innerHTML =
          feedback === 'accepted'
            ? '<span style="color:var(--green);font-size:12px">✓ 已接受并写入改进记录</span>'
            : '<span style="color:var(--muted);font-size:12px">已忽略</span>';
        setTimeout(() => { card.remove(); }, 2000);
      }
    }
  } catch(e) { alert('提交失败: '+e.message); }
}

// ══════════════════════════════════════════════════
//  AI 改进建议全文弹窗
// ══════════════════════════════════════════════════
const _suggestionTexts = {};

function showSuggestionModal(id) {
  const text = _suggestionTexts[id] || '';
  document.getElementById('modal-title').textContent = 'AI 改进建议详情';
  document.getElementById('modal-sub').textContent = '';
  document.getElementById('modal-body').innerHTML =
    '<div class="modal-section"><div style="white-space:pre-wrap;font-size:13px;line-height:1.8">' + esc(text) + '</div></div>';
  document.getElementById('modal-overlay').classList.add('open');
}

// ══════════════════════════════════════════════════
//  EMS 工具查询告警
// ══════════════════════════════════════════════════
async function loadEmsAlarms() {
  const tbody = document.getElementById('ems-alarms-tbody');
  if (!tbody) return;
  try {
    const res = await fetch('/api/db/ems-alarms?limit=200');
    const d = await res.json();
    if (!d.records || !d.records.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无数据（Agent 调用工具后自动填充）</td></tr>';
      return;
    }
    tbody.innerHTML = d.records.map(r => \`
      <tr>
        <td class="mono">\${esc(String(r.ems_id))}</td>
        <td>\${esc(r.name)}</td>
        <td>\${esc(r.level)}</td>
        <td class="muted">\${esc(r.device_type)}</td>
        <td class="muted">\${fmt(r.alarm_time)}</td>
        <td class="muted">\${r.recover_time ? fmt(r.recover_time) : '-'}</td>
        <td><span class="tag \${r.source==='realtime'?'tag-processing':'tag-done'}">\${r.source==='realtime'?'实时':'历史'}</span></td>
        <td class="mono" style="font-size:11px">\${esc(r.alarm_id)}</td>
      </tr>
    \`).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty" style="color:var(--red)">加载失败: ' + esc(e.message) + '</td></tr>';
  }
}

// ══════════════════════════════════════════════════
//  初始化 & 定时刷新
// ══════════════════════════════════════════════════
refreshOverview();
setInterval(refreshOverview, 5000);

// 日志 tab 的自动刷新
_logAutoTimer = setInterval(() => {
  if (_currentTab === 'logs') loadLogs();
}, 8000);
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

  // GET /api/db/alarm-detail/:alarmId → 告警记录 + LLM调用链 + 实时快照（三合一）
  app.get('/api/db/alarm-detail/:alarmId', (req, res) => {
    const { alarmId } = req.params as { alarmId: string };
    const alarm    = queryAlarmById(alarmId);
    const llmCalls = queryLlmCallsByAlarm(alarmId);
    const snapshot = queryRealtimeSnapshotByAlarm(alarmId);
    res.json({
      alarm:    alarm    ?? null,
      llmCalls: llmCalls,
      snapshot: snapshot ? JSON.parse(snapshot.snapshot_json) : null,
      capturedAt: snapshot?.captured_at ?? null,
    });
  });

  // GET /api/db/ems-alarms?limit=200 → EMS 工具查询告警列表
  app.get('/api/db/ems-alarms', (_req, res) => {
    const { limit } = _req.query as Record<string, string | undefined>;
    const records = queryRecentEmsAlarms(limit ? parseInt(limit, 10) : 200);
    res.json({ total: records.length, records });
  });

  // GET /api/db/token-stats → Token 用量统计
  app.get('/api/db/token-stats', (_req, res) => {
    res.json(queryTokenStats());
  });

  // GET /api/db/alarm-trend?hours=24 → 最近 N 小时每小时告警数
  app.get('/api/db/alarm-trend', (req, res) => {
    const hours = parseInt((req.query as Record<string, string>)['hours'] ?? '24', 10);
    res.json({ trend: queryAlarmTrend(Math.min(hours, 48)) });
  });

  // GET /api/logs?date=YYYY-MM-DD&level=ERROR&keyword=xxx&lines=300
  app.get('/api/logs', (req, res) => {
    const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
    const LOG_DIR = path.join(ROOT, 'logs');
    const { date, level, keyword, lines: linesParam } = req.query as Record<string, string | undefined>;
    const targetDate = date ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const logFile    = path.join(LOG_DIR, `ai-ops-${targetDate}.log`);
    const maxLines   = Math.min(parseInt(linesParam ?? '500', 10), 2000);

    // 列出可用日志日期
    let availableDates: string[] = [];
    try {
      availableDates = fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('ai-ops-') && f.endsWith('.log'))
        .map(f => f.slice(7, 17))
        .sort()
        .reverse();
    } catch { /* logs dir may not exist yet */ }

    if (!fs.existsSync(logFile)) {
      res.json({ date: targetDate, lines: [], total: 0, availableDates });
      return;
    }

    try {
      const content = fs.readFileSync(logFile, 'utf8');
      let allLines  = content.split('\n').filter(l => l.trim());
      if (level) {
        const lvlUpper = level.toUpperCase();
        allLines = allLines.filter(l => l.includes(`[${lvlUpper}`));
      }
      if (keyword) {
        const kw = keyword.toLowerCase();
        allLines = allLines.filter(l => l.toLowerCase().includes(kw));
      }
      const total = allLines.length;
      // 取最后 maxLines 行（最新的）
      const resultLines = allLines.slice(-maxLines);
      res.json({ date: targetDate, lines: resultLines, total, availableDates });
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
