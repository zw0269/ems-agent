# EMS Agent 实时告警处理逻辑链路文档

> 生成日期：2026-03-30
> 项目：EMS Agent（Node.js）储能设备智能告警根因分析系统

---

## 目录

1. [系统总览](#1-系统总览)
2. [架构分层](#2-架构分层)
3. [完整逻辑链路](#3-完整逻辑链路)
4. [阶段详解](#4-阶段详解)
   - [4.1 告警获取阶段（Heartbeat）](#41-告警获取阶段heartbeat)
   - [4.2 队列管理阶段（AlarmQueue）](#42-队列管理阶段alarmqueue)
   - [4.3 数据采集阶段（Snapshot）](#43-数据采集阶段snapshot)
   - [4.4 AI 分析阶段（AgentLoop）](#44-ai-分析阶段agentloop)
   - [4.5 通知阶段（Notifier）](#45-通知阶段notifier)
   - [4.6 持久化阶段（Database）](#46-持久化阶段database)
5. [告警优先级规则](#5-告警优先级规则)
6. [工具调用路由](#6-工具调用路由)
7. [通知策略矩阵](#7-通知策略矩阵)
8. [关键配置说明](#8-关键配置说明)
9. [异常处理机制](#9-异常处理机制)
10. [数据流图](#10-数据流图)

---

## 1. 系统总览

EMS Agent 是一个**全自动储能设备告警根因分析系统**，核心职责是：

1. **轮询**：定时从 EMS Java 后端拉取实时告警
2. **分析**：驱动 LLM（大语言模型）对告警进行根因分析，支持工具调用查询设备数据
3. **通知**：将分析结论通过邮件和钉钉推送给运维人员
4. **存档**：将所有告警和结论持久化到 SQLite 数据库

```
EMS Java 后端 ──→ Heartbeat 轮询 ──→ AlarmQueue ──→ processAlarm
                                                         ↓
                                               数据采集（并行）
                                                         ↓
                                               AgentLoop（LLM 分析）
                                                         ↓
                                         ┌───────────────┴───────────────┐
                                         ↓                               ↓
                                    邮件通知                         钉钉通知
                                         ↓                               ↓
                                         └───────────────┬───────────────┘
                                                         ↓
                                                   SQLite 存档
```

---

## 2. 架构分层

| 层级 | 模块 | 文件路径 | 职责 |
|------|------|----------|------|
| **入口层** | Main | `src/index.ts` | 启动、主循环、进程守护 |
| **网关层** | Heartbeat | `src/gateway/heartbeat.ts` | 定时轮询 EMS 告警接口 |
| **网关层** | AlarmQueue | `src/gateway/alarmQueue.ts` | 告警去重、优先级排序 |
| **网关层** | SessionManager | `src/gateway/sessionManager.ts` | 会话生命周期管理、并发防护 |
| **运行层** | AgentLoop | `src/runtime/agentLoop.ts` | LLM 分析驱动（支持工具调用迭代） |
| **运行层** | ContextManager | `src/runtime/contextManager.ts` | Prompt 构建、Token 压缩 |
| **运行层** | ToolRouter | `src/runtime/toolRouter.ts` | 工具调用路由分发 |
| **运行层** | LLMClient | `src/runtime/llmClient.ts` | LLM API 封装（多 Provider 支持） |
| **工具层** | QueryEms | `src/tools/queryEms.ts` | EMS 设备数据查询工具集 |
| **配置层** | AlarmPriority | `src/config/alarmPriority.ts` | 告警类型→优先级映射 |
| **配置层** | Thresholds | `src/config/thresholds.ts` | 阈值超限检查规则 |
| **通知层** | EmailNotifier | `src/notifier/emailNotifier.ts` | SMTP 邮件发送 |
| **通知层** | DingTalkNotifier | `src/notifier/dingTalkNotifier.ts` | 钉钉 Webhook 推送 |
| **持久层** | Database | `src/db/database.ts` | SQLite 初始化 |
| **持久层** | AlarmRepository | `src/db/alarmRepository.ts` | 告警 CRUD |
| **状态层** | StatusStore | `src/server/statusStore.ts` | 内存状态中心 |
| **状态层** | StatusServer | `src/server/statusServer.ts` | HTTP 状态面板（端口 3000） |

---

## 3. 完整逻辑链路

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         EMS Agent 实时告警完整链路                                 │
└──────────────────────────────────────────────────────────────────────────────────┘

  启动
   │
   ├─ getDb()                          ← 初始化 SQLite，创建 alarm_records 表
   ├─ checkLLMConnectivity()           ← 验证 LLM API 可达性
   ├─ startStatusServer(3000)          ← 启动 HTTP 状态面板
   ├─ Heartbeat.start()                ← 启动定时轮询（默认 30 秒）
   └─ setInterval(1000)                ← 主消费循环，每 1 秒检查队列
         │
         │ ══════════════════════════════════════════
         │          [ 心跳轮询线程 ]
         │ ══════════════════════════════════════════
         │
         ├── Heartbeat.tick()
         │     ├── 调用 EMS API: GET /grid-ems/AlarmAndEvent/realTimeAlarm/list
         │     ├── 过滤已处理告警（SessionManager 去重）
         │     ├── 转换为内部 Alarm 格式
         │     ├── AlarmQueue.push(alarm)
         │     │     ├── 检查 alarmId 是否已在队列中（去重）
         │     │     ├── 按优先级插入有序队列（P0 > P1 > P2 > P3）
         │     │     └── 更新 statusStore.queueLength
         │     └── statusStore.recordHeartbeat()
         │
         │ ══════════════════════════════════════════
         │          [ 主消费循环 ]
         │ ══════════════════════════════════════════
         │
         ├── alarm = AlarmQueue.pop()           ← 取出最高优先级告警
         │     └── 若队列空 → 本轮跳过
         │
         ├── alarm.priority = ALARM_PRIORITY[alarmType] ?? 'P2'
         │
         ├── SessionManager.start(alarmId)      ← 标记"处理中"，防止重复处理
         ├── statusStore.updateSessionCount(1)
         │
         └── processAlarm(alarm)
               │
               ├── statusStore.startAlarm(alarm)
               ├── insertAlarm(alarm, isTest)   ← 写入数据库 status='processing'
               │
               │ ══════════════════════════════════════════
               │     [ 并行数据采集 ]
               │ ══════════════════════════════════════════
               │
               ├── Promise.all([
               │     gatherSnapshot(alarm),     ← 采集实时快照（见 4.3）
               │     gatherHistory(alarm),      ← 采集历史告警（过去 24 小时）
               │   ])
               │
               ├── checkThresholds(realtime)    ← 阈值超限检查，生成 violations[]
               │
               │ ══════════════════════════════════════════
               │     [ AI 分析阶段 ]
               │ ══════════════════════════════════════════
               │
               ├── IF faultCategory === 'hardware'
               │     └── AgentLoop.runOnce()    ← 单次 LLM 调用，不循环工具
               │
               ├── ELSE IF faultCategory === 'software'
               │     └── AgentLoop.run()        ← 多轮 LLM + 工具调用迭代
               │
               └── ELSE
                     └── conclusion = "故障类型未知，请人工判断"
                           │
               ├── ← conclusion（分析结论文本）
               │
               │ ══════════════════════════════════════════
               │     [ 通知阶段 ]
               │ ══════════════════════════════════════════
               │
               ├── notifyOperator(alarm, conclusion)
               │     ├── P0/P1/P2 → EmailNotifier.send()
               │     ├── P0/P1/P2 → DingTalkNotifier.send()
               │     └── P3 → 仅写日志
               │
               │ ══════════════════════════════════════════
               │     [ 持久化阶段 ]
               │ ══════════════════════════════════════════
               │
               ├── updateAlarmFinished(alarmId, conclusion, isError, durationMs)
               ├── statusStore.finishAlarm(alarmId, conclusion, isError)
               └── SessionManager.finish(alarmId)  ← 24 小时后自动清理
```

---

## 4. 阶段详解

### 4.1 告警获取阶段（Heartbeat）

**文件**：`src/gateway/heartbeat.ts`
**触发频率**：每 `HEARTBEAT_INTERVAL_SECONDS`（默认 30）秒执行一次

```
Heartbeat.tick()
  │
  ├── GET /grid-ems/AlarmAndEvent/realTimeAlarm/list
  │     响应字段：alarmId, alarmType, deviceId, faultCategory, startTime, description
  │
  ├── 过滤条件：
  │     - SessionManager 中已存在（处理中/已完成）的 alarmId → 跳过
  │
  ├── 字段映射（AlarmItem → Alarm）：
  │     alarmType → faultCategory（hardware/software）
  │     deviceId  → 设备唯一标识
  │
  └── AlarmQueue.push(alarm)
```

### 4.2 队列管理阶段（AlarmQueue）

**文件**：`src/gateway/alarmQueue.ts`

| 操作 | 说明 |
|------|------|
| `push(alarm)` | 去重后按优先级有序插入 |
| `pop()` | 取出队列头部（最高优先级） |
| `length` | 当前队列长度 |

优先级排序规则：P0(0) > P1(1) > P2(2) > P3(3)，数值越小越优先。

**SessionManager** 双重保护：
- 入队时：已在 Session 中的告警不再入队
- 处理时：同一 alarmId 不会并发处理

### 4.3 数据采集阶段（Snapshot）

**并行调用 4 个 EMS 接口**，合并为扁平 realtime 对象：

```
Promise.all([
  getHomePage()     → /grid-ems/dashboard/getHomePage
                       → batterySOC, batteryVoltage, gridFrequency 等首页聚合数据

  getBmsYx()        → /grid-ems/bms/yx
                       → BMS 遥信点位（布尔值）
                       → 过滤 value===true → bmsActiveAlarms[]

  getPcsYc()        → /grid-ems/pcs/yc
                       → PCS 遥测数值列表 → 转为 key:value 扁平对象

  getPcsYx()        → /grid-ems/pcs/yx
                       → PCS 遥信点位
                       → sort===1 & value===true → pcsActiveFaults[]
                       → sort===2 & value===true → pcsActiveAlarms[]
])

gatherHistory()     → /grid-ems/AlarmAndEvent/historyAlarm/list
                       → 过去 24 小时历史告警列表
```

采集完成后执行 **阈值检查**（`checkThresholds`），生成超限项列表 `violations[]` 直接注入分析 Prompt。

### 4.4 AI 分析阶段（AgentLoop）

**文件**：`src/runtime/agentLoop.ts`

#### 硬件故障（hardware）→ 单次调用

```
AgentLoop.runOnce(alarm, realtime, history, violations)
  │
  ├── ContextManager.buildSystemPrompt('hardware')   ← 硬件分析专用 Prompt
  ├── ContextManager.buildUserMessage(alarm, data)   ← 注入实时数据 + 阈值违规项
  ├── LLMClient.call(messages)                       ← 单次 LLM 请求
  │     max_tokens: 4096
  │     支持 Provider: anthropic / openai / openai-compatible
  │
  └── 返回 conclusion 文本
```

#### 软件故障（software）→ 多轮工具调用循环

```
AgentLoop.run(alarm, { realtime, history, violations })
  │
  ├── 最大迭代次数：30 轮
  │
  ├── FOR iteration in [0..29]:
  │     │
  │     ├── ContextManager.buildMessages()   ← 含历史工具调用记录
  │     ├── LLMClient.call(messages, TOOLS)  ← LLM + 工具定义
  │     │
  │     ├── IF response.type === 'final_answer':
  │     │     └── return conclusion ✓
  │     │
  │     ├── IF response.type === 'tool_call':
  │     │     ├── ToolRouter.run(toolName, args)   ← 执行工具（见 4.6）
  │     │     ├── ContextManager.addToolResult()   ← 追加结果到上下文
  │     │     └── 若 estimatedTokens > 80000 → ContextManager.compact() 压缩
  │     │
  │     └── continue...
  │
  └── IF 超出最大迭代 → return "分析超时，请人工介入"
```

**LLM 重试机制**：请求失败自动指数退避重试，最多 `LLM_MAX_RETRIES`（默认 3）次。

### 4.5 通知阶段（Notifier）

**文件**：`src/notifier/index.ts`

```
notifyOperator(alarm, conclusion)
  │
  ├── subject = `【P0】EMS 告警分析报告 - battery_smoke`
  │
  ├── operatorEmails      = OPERATOR_EMAILS.split(',')
  └── operatorDingTalkIds = OPERATOR_DINGTALK_IDS.split(',')
        │
        ├── IF priority in ['P0','P1','P2'] AND emails 非空:
        │     EmailNotifier.send({ to, subject, body: conclusion })
        │       └── SMTP (QQ 邮箱 465/SSL)，正文为分析结论全文
        │
        ├── IF priority in ['P0','P1','P2'] AND dingTalkIds 非空:
        │     DingTalkNotifier.send({ userIds, title, content: conclusion })
        │       └── POST https://oapi.dingtalk.com/robot/send?access_token=xxx
        │           payload.msgtype = 'markdown'
        │           payload.at.atUserIds = [userId]  ← @ 运维人员
        │
        └── IF priority === 'P3':
              仅写 logger，不发送任何通知
```

### 4.6 持久化阶段（Database）

**文件**：`src/db/alarmRepository.ts`，使用 SQLite（`better-sqlite3`）

| 时机 | 操作 | 说明 |
|------|------|------|
| 告警入队时 | `insertAlarm()` | status='processing', is_test 标记 |
| 分析完成时 | `updateAlarmFinished()` | status='done'/'error', conclusion, duration_ms |

---

## 5. 告警优先级规则

**文件**：`src/config/alarmPriority.ts`

| 优先级 | 告警类型 | 含义 |
|--------|----------|------|
| **P0** | `battery_smoke`, `fire_alarm`, `emergency_stop` | 紧急，可能导致设备损坏 |
| **P1** | `cell_voltage_high`, `cell_temp_high`, `insulation_error`, `pcs_communication_lost`, `pcs_grid_error` | 重要，影响系统正常运行 |
| **P2** | `soc_low`, `fan_error`, `comm_error` | 一般，需关注 |
| **P3** | 其他未定义类型 | 提示，仅记录日志 |

> 未在映射表中的告警类型默认分配 **P2**。

---

## 6. 工具调用路由

**文件**：`src/runtime/toolRouter.ts`，`src/tools/queryEms.ts`

LLM 在 software 模式分析中可调用以下工具（最多 30 轮）：

| 工具名 | API 端点 | 返回数据 |
|--------|----------|----------|
| `getHomePage` | `/grid-ems/dashboard/getHomePage` | 系统聚合状态（SOC、电压、频率等） |
| `getBmsYx` | `/grid-ems/bms/yx` | BMS 遥信点位（布尔状态） |
| `getPcsYc` | `/grid-ems/pcs/yc` | PCS 遥测数值 |
| `getPcsYx` | `/grid-ems/pcs/yx` | PCS 遥信点位 |
| `getDcdcYc` | `/grid-ems/dcdc/yc` | DCDC 遥测数值 |
| `getDcdcYx` | `/grid-ems/dcdc/yx` | DCDC 遥信点位 |
| `getMeterYc` | `/grid-ems/meter/yc` | 电表遥测数值 |
| `getMeterYx` | `/grid-ems/meter/yx` | 电表遥信点位 |
| `getRealTimeAlarms` | `/grid-ems/AlarmAndEvent/realTimeAlarm/list` | 当前实时告警列表 |
| `getHistoryAlarms` | `/grid-ems/AlarmAndEvent/historyAlarm/list` | 历史告警（带时间范围） |
| `queryBms` | `/grid-ems/bms/detail` | BMS 详细数据 |
| `queryHistory` | (历史数据查询) | 历史趋势数据 |

**Token 压缩机制**：当估算 Token 数 > 80,000 时，自动调用 `ContextManager.compact()` 对上下文进行摘要压缩，保证长分析不超出 LLM 限制。

---

## 7. 通知策略矩阵

| 告警优先级 | 邮件通知 | 钉钉推送 | 日志记录 |
|-----------|----------|----------|----------|
| P0 | ✅ 发送 | ✅ 发送（@ 运维） | ✅ |
| P1 | ✅ 发送 | ✅ 发送（@ 运维） | ✅ |
| P2 | ✅ 发送 | ✅ 发送（@ 运维） | ✅ |
| P3 | ❌ 不发送 | ❌ 不发送 | ✅ 仅日志 |
| 分析异常 | ✅ 发送错误摘要 | ✅ 发送错误摘要 | ✅ |

**钉钉消息格式**：
```
### 【P1】EMS 告警分析报告 - cell_voltage_high

{AI 分析结论全文（Markdown 格式）}
```

---

## 8. 关键配置说明

**文件**：`.env`

```ini
# LLM Provider
LLM_PROVIDER=anthropic | openai | openai-compatible
LLM_MODEL=claude-opus-4-6 / gpt-4o / deepseek-chat 等
LLM_API_KEY=xxx
LLM_BASE_URL=（仅 openai-compatible 时填写）
LLM_MAX_RETRIES=3

# EMS Java 后端
EMS_BASE_URL=http://xxx:9812

# 轮询间隔
HEARTBEAT_INTERVAL_SECONDS=30

# 状态面板端口
STATUS_PORT=3000

# 邮件（QQ SMTP）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=xxx@qq.com
SMTP_PASSWORD=（QQ 邮箱授权码）

# 钉钉
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx

# 通知对象（逗号分隔）
OPERATOR_EMAILS=op1@xxx.com,op2@xxx.com
OPERATOR_DINGTALK_IDS=dingUserId1,dingUserId2
```

---

## 9. 异常处理机制

| 异常类型 | 处理方式 |
|----------|----------|
| LLM API 调用失败 | 指数退避重试 3 次，失败后抛出错误 |
| 工具调用失败 | 捕获错误，返回错误描述给 LLM，继续循环 |
| 分析超出 30 轮 | 返回"超时，请人工介入"结论 |
| 邮件发送失败 | 捕获并 logger.error 记录，不影响主流程 |
| 钉钉发送失败 | 捕获并 logger.error 记录，不影响主流程 |
| processAlarm 整体异常 | 发送包含错误信息的通知，写入数据库 status='error' |
| 未捕获异常（进程级） | `process.on('uncaughtException')` 记录日志，进程继续 |
| 未处理 Promise 拒绝 | `process.on('unhandledRejection')` 记录日志 |

---

## 10. 数据流图

```
┌─────────────┐    HTTP Polling     ┌─────────────────────┐
│  EMS Java   │◄────────────────────│     Heartbeat        │
│   Backend   │                     │  (每 30 秒)          │
│ :9812       │─────────────────────►│  告警列表 + 数据查询  │
└─────────────┘    API Response     └──────────┬──────────┘
                                               │ push
                                    ┌──────────▼──────────┐
                                    │     AlarmQueue       │
                                    │  P0 > P1 > P2 > P3  │
                                    │  + 去重              │
                                    └──────────┬──────────┘
                                               │ pop (每 1 秒)
                                    ┌──────────▼──────────┐
                                    │   processAlarm()     │
                                    │                      │
                                    │  ┌──────────────┐   │
                                    │  │ gatherSnapshot│   │──► SQLite (status=processing)
                                    │  │ gatherHistory │   │
                                    │  └──────┬───────┘   │
                                    │         │ data      │
                                    │  ┌──────▼───────┐   │
                                    │  │ checkThresh  │   │
                                    │  └──────┬───────┘   │
                                    │         │ violations│
                                    │  ┌──────▼───────┐   │
                                    │  │  AgentLoop   │   │
                                    │  │  hardware:   │   │
                                    │  │   runOnce()  │   │
                                    │  │  software:   │   │
                                    │  │   run()      │   │◄──► LLM API
                                    │  │   工具迭代   │   │◄──► EMS 数据工具
                                    │  └──────┬───────┘   │
                                    │         │ conclusion│
                                    └─────────┼───────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                ┌─────────▼──────┐  ┌─────────▼──────┐  ┌────────▼───────┐
                │  EmailNotifier │  │DingTalkNotifier│  │    SQLite DB   │
                │  SMTP:465      │  │ Webhook POST   │  │ status='done'  │
                │  P0/P1/P2      │  │ P0/P1/P2       │  │ conclusion     │
                └────────────────┘  └────────────────┘  └────────────────┘
                          │                   │
                ┌─────────▼──────┐  ┌─────────▼──────┐
                │  运维人员邮箱  │  │  钉钉群机器人  │
                └────────────────┘  └────────────────┘
```

---

*本文档由 Claude Code 基于代码分析自动生成，如代码逻辑有更新请同步更新此文档。*
