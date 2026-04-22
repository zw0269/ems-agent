# AI 代码修改记录

---

## 2026-04-03（BUG-1）— 修复 queryPcs 数据路由错误

### 问题
`toolRouter.ts` 中 `queryPcs` 和 `queryBms` 共用同一个 case，LLM 调用 `queryPcs` 时实际查询的是 BMS 数据，PCS 数据从未被正确获取。

### [修改] `src/tools/queryEms.ts`
新增 `queryPcs(args)` 函数：
- 并行调用 `GET /grid-ems/pcs/yc`（遥测）和 `GET /grid-ems/pcs/yx`（遥信）
- 支持可选 `fields` 参数按 `item.key` 过滤返回结果
- 返回结构 `{ yc: PcsYcItem[], yx: PcsYxItem[] }`
- 完整 logger 记录（含两端返回条数和耗时）

### [修改] `src/runtime/toolRouter.ts`
- 拆分 `queryBms`/`queryPcs` 的合并 case 为独立 case
- `queryPcs` 路由到新建的 `queryPcs()` 函数（之前错误路由到 `queryBms()`）
- 导入新函数 `queryPcs`

### [修改] `src/tools/index.ts`
- 更新 `queryPcs` 工具描述：明确说明同时返回遥测+遥信合并数据
- `fields` 参数改为可选（之前 required）
- 新增 `deviceId` 参数说明（预留）

---

## 2026-04-03（EXP-1~3）— 三项扩展功能

### EXP-1 [修改] `src/index.ts`
P3 告警早退出（Early Return）：
- 在 `processAlarm()` 数据采集前，判断 `alarm.priority === 'P3'`
- P3 直接生成固定结论文本、更新数据库状态，不触发任何 LLM 调用
- 节省 100% P3 告警的 API 费用（通讯延迟类告警无需 LLM 分析）

### EXP-2 [修改] `src/gateway/alarmQueue.ts`
新增 `popByPriority(priority)` 方法：
- 从队列中找到第一个匹配优先级的告警并移除，不影响其余元素顺序

### EXP-2 [修改] `src/index.ts`
P0 独立消费者（快速通道）：
- 200ms 轮询间隔（主循环 1000ms）
- 使用 `popByPriority('P0')` 专摘 P0 告警
- 不 `await processAlarm()`，并发执行，不阻塞主队列
- 确保 P0 告警在 P1 长耗时处理期间也能立即响应

### EXP-3 [修改] `src/runtime/agentLoop.ts`
软件故障结论格式验证：
- `final_answer` 返回后检查是否包含"根因"、"证据链"、"操作建议"三个章节
- 缺少任意章节时（且剩余迭代次数 > 1），追加修正请求消息并 continue 进入下一迭代
- 仅触发一次修正（`i < maxIterations - 1`），防止无限修正循环

---

## 2026-04-03（INT-1+2）— KNOWLEDGE.md 集成 + Session 计数语义修复

### INT-1 [修改] `src/llm/prompts.ts`
- 新增 `KNOWLEDGE_PATH` 指向项目根目录的 `KNOWLEDGE.md`
- 新增 `loadKnowledgeMd()` 函数，热加载领域知识（无文件时静默返回空串）
- `buildSystemPrompt()` 在 self-improvement 注入前先注入 `KNOWLEDGE.md` 内容
- 注入格式：`【设备领域知识库】\n{内容}`，优先于改进建议出现

### INT-2 [修改] `src/server/statusStore.ts`
- 新增 `incrementSession()` / `decrementSession()` 方法，语义明确
- `decrementSession()` 有下限保护（不低于 0）
- 保留 `updateSessionCount(n)` 并标记为 `@deprecated`，防止其他调用方报错

### [修改] `src/index.ts`
- 主消费循环中 `updateSessionCount(1)` → `incrementSession()`
- `updateSessionCount(0)` → `decrementSession()`

---

## 2026-04-03（DB-1）— llm_calls 表添加 token 用量字段

### [修改] `src/db/database.ts`
- `CREATE TABLE llm_calls` 新增 `input_tokens INTEGER NOT NULL DEFAULT 0` 和 `output_tokens INTEGER NOT NULL DEFAULT 0` 两列
- 添加迁移代码（`ALTER TABLE ADD COLUMN`）兼容已存在的数据库，捕获"列已存在"异常

### [修改] `src/db/llmCallRepository.ts`
- `LlmCallRecord` 接口新增 `input_tokens: number`、`output_tokens: number` 字段
- `insertLlmCall()` 参数新增可选 `inputTokens`、`outputTokens`，写入时传入（默认 0）

### [修改] `src/llm/client.ts`
- `callAnthropic()` 返回类型改为 `{ response, inputTokens, outputTokens }`，从 `response.usage` 解析
- `callOpenAI()` 同样解析 `usage.prompt_tokens` / `usage.completion_tokens`
- `call()` 统一入口解构两个方法的返回值，写入日志（含 token 数）和数据库

---

## 2026-04-03（TOOL-1+2）— 删除幽灵工具 + 精简工具描述

### T1 [修改] `src/tools/index.ts`
删除两个指向不存在接口的遗留工具：
- `queryBms`（指向 `/api/telemetry/bms`，不存在）
- `queryHistory`（指向 `/api/history`，不存在）
保留并已修复的 `queryPcs`（BUG-1 已修复为真实接口）

### T2 [修改] `src/tools/index.ts`
重写所有 11 个工具描述：
- 去掉字段枚举列表（从平均 60 字缩短到 25 字以内）
- 聚焦"何时调用此工具"而非"返回哪些字段"
- `getDcdcYc/Yx`、`getMeterYc/Yx` 描述精简参数说明

### [修改] `src/runtime/toolRouter.ts`
- 删除 `queryBms`、`queryHistory` 的 case 分支
- 删除不再使用的 `queryBms`、`queryHistory` import

---

## 2026-04-03（DESIGN-1~5）— 五项设计缺陷修复

### D1 [修改] `src/runtime/agentLoop.ts`
- `maxIterations` 从 30 改为 20（设计文档原值为 10，折中取 20 防止合理复杂告警截断）

### D2 [修改] `src/runtime/agentLoop.ts`
- 三处 `await this.runSelfReflection(...)` 改为 fire-and-forget 模式（`.catch()` 处理错误）
- 自我反思不再阻塞 `notifyOperator()` 的调用，P0 告警通知提前 2~10 秒送达

### D3 [修改] `src/index.ts`
- `AgentLoop` 实例从 `processAlarm()` 函数内部提升为模块级单例
- 避免每次告警重建 Anthropic/OpenAI SDK 客户端和 HTTP 连接池

### D4 [修改] `src/gateway/heartbeat.ts`
- 新增 `consecutiveFailures`（连续失败计数）和 `skipCounter`（退避跳过计数）字段
- 实现分级退避：失败 3 次每隔 1 次执行，失败 6 次每隔 3 次，失败 10 次每隔 9 次（约 5 分钟）
- 连续失败 3 次后日志从 `error` 降级为 `warn`，减少噪音
- 成功后自动重置失败计数

### D5 [修改] `src/runtime/contextManager.ts`
- `addAssistant()` 在原有 `content` 估算基础上，补充 `toolCalls` 序列化 JSON 的 token 估算
- 修复 LLM 返回 tool_call 时 content 为空导致 token 系统性低估的问题

---

## 2026-04-03（BUG-3）— 修复 compact() 破坏 tool_use/tool_result 配对

### 问题
原 `compact()` 固定取末尾 3 条消息，若切断点恰好在 `tool_result` 前面（缺少对应 `assistant(tool_use)`），下一次 Anthropic API 调用会返回 400 错误。

### [修改] `src/runtime/contextManager.ts`
重写 `compact()` 安全截断策略：
- 从末尾向前扫描，寻找最近一个非 tool_result 的 `user` 消息作为安全截断起始点
- 保留结构：`system` + `firstUser` + 压缩占位占位符 + 安全截断点之后的全部消息
- 确保保留的末尾消息序列始终以完整的 `user` 消息开头，不破坏 tool_use/tool_result 配对
- 避免重复保留 firstUser（当其已在 tail 中时跳过）

---

## 2026-04-03（BUG-2）— 自我改进定期聚合（方案B）

### 问题
用户在 Web 面板接受 AI 建议后，虽然会追加到 `self-improvement.md`，但随着时间累积文件内容会不断增长、出现重复建议，缺乏整理机制。

### [修改] `src/db/selfImprovementRepository.ts`
新增 `aggregateAcceptedSuggestions()` 函数：
- 查询 DB 中所有 `user_feedback='accepted'` 的建议，按时间升序排列
- 按 `suggestion_text` 前 100 字去重（保留最早的一条）
- 重写 `self-improvement.md`：包含聚合时间戳、去重统计、每条建议的告警 ID + 用户备注
- 无已接受建议时写提示性空文件（防止旧内容残留误导 LLM）

### [修改] `src/index.ts`
- 导入 `node-cron` 和 `aggregateAcceptedSuggestions`
- 启动时立即执行一次聚合（确保上次运行期间累积的接受建议立即生效）
- 注册每日凌晨 2:00 的 cron job 自动重整

---

## 2026-03-30（第十批）— SQLite 数据库持久化

### [新增] `src/db/database.ts`
SQLite 单例初始化：
- 数据库文件：`data/ems-agent.db`（自动创建目录）
- WAL 模式（写性能优化）
- 建表 `alarm_records`：alarm_id / alarm_type / fault_category / device_id / priority / alarm_timestamp / started_at / finished_at / duration_ms / status / conclusion / is_test
- 建索引：`started_at DESC`、`status`

### [新增] `src/db/alarmRepository.ts`
数据仓库，提供 4 个函数：
- `insertAlarm(alarm, isTest)` — 告警开始时写入（status=processing）
- `updateAlarmFinished(alarmId, conclusion, isError, durationMs)` — 完成时更新结论/状态/耗时
- `queryRecentAlarms(limit)` — 查最近 N 条，默认 50
- `queryAlarmsByRange(startAt, endAt)` — 按时间范围查询
- `queryStats()` — 返回 total/done/error/processing 统计

### [修改] `src/index.ts`
- 启动时调用 `getDb()` 确保表结构就绪
- `processAlarm` 开始时调用 `insertAlarm()`，自动识别 TEST- 前缀标记测试告警
- 处理完成（成功/失败）均调用 `updateAlarmFinished()` 写入结论和耗时

### [修改] `src/server/statusServer.ts`
新增数据库查询 API：
- `GET /api/db/alarms?limit=50` — 查最近 N 条记录
- `GET /api/db/alarms?start=...&end=...` — 按时间范围查询
- `GET /api/db/stats` — 返回统计汇总

### [修改] `.gitignore`
新增 `data/` 排除 SQLite 数据库文件

---

## 2026-03-30（第九批）— QQ 邮箱 SMTP 优化

### [修改] `src/notifier/emailNotifier.ts`
重写邮件发送器：
- 新增 `SMTP_SECURE`、`SMTP_FROM_NAME` 环境变量读取
- 加入 `tls: { rejectUnauthorized: false }` 兼容 QQ 邮箱 SSL 直连
- 发件人显示为 `"EMS Agent 告警" <xxx@qq.com>` 格式
- 正文同时发送 `text`（纯文本）和 `html`（带样式卡片）两个版本
- HTML 正文：暗色标题栏 + 白色内容区 + 换行符自动转 `<br>`，防 XSS 转义
- 替换全部 `console.*` 为 `logger.*`，抛出异常供 `notifier/index.ts` 捕获并记录

### [修改] `.env`
- `SMTP_HOST` → `smtp.qq.com`
- `SMTP_PORT` → `465`，`SMTP_SECURE=true`
- `SMTP_USER` → `179115024@qq.com`
- 新增 `SMTP_FROM_NAME=EMS Agent 告警`
- `SMTP_PASSWORD` 留空，填写 QQ 邮箱「授权码」

### [修改] `.env.example`
- 新增 QQ / 163 / 企业邮箱三种 SMTP 配置说明
- 新增 `SMTP_SECURE`、`SMTP_FROM_NAME` 示例

---

## 2026-03-30（第八批）— 全链路接入真实接口，修复 404

### [修改] `src/config/thresholds.ts`
完全重写，字段名改为真实 API 的 key：
- `batterySOC`（5%~100%）、`batteryVoltage`（700~1050V）— 来自 HomePageData
- `gridFrequency`（49.5~50.5Hz）、`pcsInsulationresistance`（≥100kΩ）、`pcsLeakageCurrent`（≤1A）— 来自 PCS yc
- 温度：`pcsOutletAirTemp`（≤75℃）、`pcsTempPhaseA/B/C`（≤80℃）、`moduleTemperatureMax`（≤60℃）
- `checkThresholds` 参数类型改为 `Record<string, unknown>`，增加 `typeof val !== 'number'` 守卫

### [修改] `src/tools/queryHistory.ts`
彻底替换占位接口 `/api/history`（404）：
- 改为调用 `getHistoryAlarms({ startTime, endTime })`
- `hours` 参数换算为绝对时间范围传给真实接口
- 支持 `deviceId` 过滤：按 `deviceType` 模糊匹配

### [修改] `src/index.ts`
重写 `processAlarm` 数据采集层，完全移除假接口调用：
- 新增 `gatherSnapshot(alarm)`：并行调用 `getHomePage` + `getBmsYx` + `getPcsYc` + `getPcsYx`，合并为扁平 `realtime` 对象
  - PCS yc 数组转换为 `key→value` map 合并入快照
  - 附加 `bmsActiveAlarms`、`pcsActiveFaults`、`pcsActiveAlarms` 摘要数组
- 新增 `gatherHistory(alarm)`：调用 `getHistoryAlarms` 获取最近 24h 历史告警
- `processAlarm` 并行执行 `gatherSnapshot` + `gatherHistory`，再调用 `checkThresholds`
- 移除 `getFields`、`queryBms`、`queryHistory` 的直接调用（改由 ToolRouter 按需调用）
- 日志中增加 `realtimeKeys`、`historyCount`、`violations` 详情

---

## 2026-03-30（第七批）

### [修改] `src/tools/queryBms.ts`
修复 `fetchAlarms` 404 问题：
- 原来调用不存在的 `/api/alarms`，改为真实接口 `/grid-ems/AlarmAndEvent/realTimeAlarm/list`
- 新增 `toFaultCategory()`：BMS/DCDC → hardware，PCS/Meter → software
- 新增 `toAlarmPriority()`：告警 level 字符串 → P0-P3
- 将 `AlarmItem` 转换为 Agent 内部 `Alarm` 格式，全程 logger 记录
- `queryBms` 替换 `console.*` 为 `logger.*`

### [修改] `src/server/statusServer.ts`
新增手动测试告警功能：
- `startStatusServer(port, alarmQueue?)` 新增可选 `AlarmQueue` 参数
- 新增 `POST /api/test-alarm` 接口，接收 `{ alarmType, faultCategory, deviceId, priority }` 并 push 到队列
- 生成 `TEST-{timestamp}` 格式的 alarmId，参数校验 + logger 记录
- HTML 面板新增"手动注入测试告警"区域，含表单（告警类型/故障分类/设备ID/优先级）和提交按钮
- 注入成功/失败均有行内反馈提示

### [修改] `src/index.ts`
- `startStatusServer` 调用移至 Gateway 初始化之后，传入 `alarmQueue` 实例

---

## 2026-03-30（第六批）

### [修改] `src/types/index.ts`
新增共用告警接口类型：
- `AlarmItem`：`{ id, name, level, deviceType, alarmTime, recoverTime? }` — 实时/历史告警条目共用

### [修改] `src/tools/queryEms.ts`
新增两个告警查询函数：
- `getRealTimeAlarms()` → `GET /grid-ems/AlarmAndEvent/realTimeAlarm/list`
  无参数，返回全部活跃告警；日志记录条数及每条告警摘要
- `getHistoryAlarms({ startTime?, endTime? })` → `GET /grid-ems/AlarmAndEvent/historyAlarm/list`
  时间参数可选，默认查最近 24 小时；日志记录时间范围、条数及每条告警摘要（含恢复时间）

### [修改] `src/tools/index.ts`
新增两个 LLM 工具定义：
- `getRealTimeAlarms`：无需参数
- `getHistoryAlarms`：可选参数 `startTime`、`endTime`（格式 `YYYY-MM-DD HH:mm:ss`）

### [修改] `src/runtime/toolRouter.ts`
- 导入 `getRealTimeAlarms`、`getHistoryAlarms`
- switch 中新增对应 case

---

## 2026-03-30（第五批）

### [修改] `src/types/index.ts`
新增两个接口类型：
- `MeterYcItem`：`{ key, keyStr, value: number, valueStr }` — 电表遥测数据点
- `MeterYxItem`：`{ key, keyStr, value: boolean | number, valueStr, sort }` — 电表遥信状态点

### [修改] `src/tools/queryEms.ts`
新增两个接口调用函数，共用 `index` 参数区分电表1/2：
- `getMeterYc({ index })` → `GET /grid-ems/meter/yc?index=N`
  日志提取关键指标：总有功功率、总无功功率、总功率因数、正/反向有功电能
- `getMeterYx({ index })` → `GET /grid-ems/meter/yx?index=N`
  日志记录通讯诊断状态及故障 key 列表

### [修改] `src/tools/index.ts`
新增两个 LLM 工具定义：
- `getMeterYc`：必填参数 `index: number`（0=电表1，1=电表2）
- `getMeterYx`：必填参数 `index: number`（0=电表1，1=电表2）

### [修改] `src/runtime/toolRouter.ts`
- 导入 `getMeterYc`、`getMeterYx`
- switch 中新增对应 case

---

## 2026-03-30（第四批）

### [修改] `src/types/index.ts`
新增两个接口类型：
- `DcdcYcItem`：`{ key, keyStr, value: number, valueStr }` — DCDC 遥测数据点
- `DcdcYxItem`：`{ key, keyStr, value: boolean | number, valueStr, sort }` — DCDC 遥信状态点

### [修改] `src/tools/queryEms.ts`
新增两个接口调用函数，共用 `index` 参数区分 DCDC1/2：
- `getDcdcYc({ index })` → `GET /grid-ems/dcdc/yc?index=N`
  日志提取关键指标：当前/允许运行功率、BAT/BUS 侧电压、模块最高温度
- `getDcdcYx({ index })` → `GET /grid-ems/dcdc/yx?index=N`
  日志分别记录 sort=1 的故障 key 和数值非 0 的故障代码

### [修改] `src/tools/index.ts`
新增两个 LLM 工具定义：
- `getDcdcYc`：必填参数 `index: number`（0=DCDC1，1=DCDC2）
- `getDcdcYx`：必填参数 `index: number`（0=DCDC1，1=DCDC2）

### [修改] `src/runtime/toolRouter.ts`
- 导入 `getDcdcYc`、`getDcdcYx`
- switch 中新增对应 case，将 `args`（含 index）直接传入函数

---

## 2026-03-30（第三批）

### [修改] `src/types/index.ts`
新增两个接口类型：
- `PcsYcItem`：`{ key, keyStr, value: number, valueStr }` — PCS 遥测数据点
- `PcsYxItem`：`{ key, keyStr, value: boolean | number, valueStr, sort }` — PCS 遥信状态点

### [修改] `src/tools/queryEms.ts`
新增两个接口调用函数：
- `getPcsYc()` → `GET /grid-ems/pcs/yc`
  返回 PCS 全部遥测数据（三相电压/电流/功率/功率因数、输入直流参数、温度、累计充放电量、漏电流、绝缘电阻、DCDC 数据等）
  日志中提取关键指标：总有功功率、输入功率、输入电压、运行状态、出风口温度
- `getPcsYx()` → `GET /grid-ems/pcs/yx`
  返回 PCS 全部遥信状态（运行/并网/故障/告警状态、控制软件故障字 1-5、通讯软件故障字 1-2）
  日志中分别记录 sort=1（故障）和 sort=2（告警）的触发 key 列表

### [修改] `src/tools/index.ts`
新增两个 LLM 工具定义：
- `getPcsYc`：获取 PCS 遥测实时数据，无需参数
- `getPcsYx`：获取 PCS 遥信状态，无需参数

### [修改] `src/runtime/toolRouter.ts`
- 导入 `getPcsYc`、`getPcsYx`
- switch 中新增对应 case 路由

---

## 2026-03-30（第二批）

### [新增] `src/tools/queryEms.ts`
接入真实 EMS 后端接口。
- `getHomePage()` → `GET {EMS_BASE_URL}/grid-ems/dashboard/getHomePage`
  返回首页综合数据：光伏/储能/电网/负载/PCS/BMS 实时参数、SOC、系统状态、告警计数
- `getBmsYx()` → `GET {EMS_BASE_URL}/grid-ems/bms/yx`
  返回 BMS 所有遥信状态点（80+ 项），`value=true` 表示告警触发
- 校验 `code === 200`，失败抛出含接口原始 msg 的错误
- 全程 `logger` 记录，包含触发告警 key 列表

### [修改] `src/types/index.ts`
新增两个接口类型：
- `HomePageData`：映射 `/getHomePage` 全部 42 个字段
- `BmsYxItem`：`{ key, keyStr, value: boolean | number, valueStr, sort }`

### [修改] `src/tools/index.ts`
在 `TOOLS_DEFINITION` 头部注册两个新工具供 LLM 调用：
- `getHomePage`：获取系统综合数据，无需参数
- `getBmsYx`：获取 BMS 遥信状态，无需参数

### [修改] `src/runtime/toolRouter.ts`
- 导入 `getHomePage`、`getBmsYx`
- 在 `switch` 中新增两个 case 路由

### [修改] `.env`
- `EMS_BASE_URL` 更新为真实地址 `http://8.153.70.217:9812`

记录 AI 对本项目所做的所有代码变更，按时间倒序排列。

---

## 2026-03-30

### [新增] `src/utils/logger.ts`
AI 操作日志工具，每日轮转写入 `logs/ai-ops-YYYY-MM-DD.log`。
- 无外部依赖，使用 `fs.appendFileSync`
- 格式：`ISO时间 [LEVEL] [Module] message | {json上下文}`
- 导出 `logger.info / logger.warn / logger.error`

### [修改] `src/llm/client.ts`
完全重写，支持多 LLM 提供商。
- 新增 `LLMProviderType = 'anthropic' | 'openai' | 'openai-compatible'`
- 统一入口 `call()`，内部分发 `callAnthropic()` / `callOpenAI()`
- 增加指数退避重试（`LLM_MAX_RETRIES`，默认 3 次）
- 新增 `toAnthropicMessages()` 消息格式转换（OpenAI → Anthropic）
- 全面集成 `logger`，记录每次 API 调用的参数、耗时、结果
- 读取环境变量：`LLM_PROVIDER`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_BASE_URL`、`LLM_MAX_RETRIES`

### [修改] `src/types/index.ts`
扩展类型定义以支持工具调用链。
- 新增 `ToolCall` 接口（`id`、`type`、`function.name`、`function.arguments`）
- `Message` 新增 `tool_calls?: ToolCall[] | undefined`、`tool_call_id?: string | undefined`
- `LLMResponse` 新增 `toolCallId?: string | undefined`
- 全部可选字段补充 `| undefined`，兼容 `exactOptionalPropertyTypes` 严格模式

### [修改] `src/runtime/contextManager.ts`
修复工具调用上下文存储。
- `addAssistant()` 正确存储 `tool_calls` 数组（之前被注释掉）
- `addToolResult()` 正确存储 `tool_call_id`
- 使用条件赋值 `if (x) msg.prop = x` 模式

### [修改] `src/runtime/agentLoop.ts`
修复 `toolCallId` 传递链，集成日志。
- `toolCallId` 正确从 LLM 响应传入 `addAssistant()` 和 `addToolResult()`
- 记录每次迭代开始、工具调用决策（含完整参数）、结论、超时

### [修改] `src/runtime/toolRouter.ts`
- 替换全部 `console.*` 为 `logger.*`
- 记录工具名称、参数、执行耗时、错误信息

### [新增] `src/server/statusStore.ts`
运行时状态单例，供状态面板使用。
- 跟踪：`llmApiOk`、`queueLength`、`activeSessionCount`、`totalProcessed`、`totalErrors`、`lastHeartbeat`、`recentAlarms`（最多 20 条）
- 方法：`setLLMApiStatus`、`updateQueueLength`、`updateSessionCount`、`recordHeartbeat`、`startAlarm`、`finishAlarm`

### [新增] `src/server/statusServer.ts`
Express HTTP 状态面板服务器。
- `GET /` → 内嵌 HTML 仪表盘（暗色主题、卡片布局、5 秒自动刷新）
- `GET /api/status` → JSON 状态数据

### [新增] `src/utils/healthCheck.ts`
启动时 LLM API 连通性测试。
- 发送 `Reply with exactly: OK` 测试消息
- 返回 `boolean`，失败不阻断启动流程
- 使用 `logger` 记录测试过程与耗时

### [修改] `src/gateway/heartbeat.ts`
- 添加 `statusStore.recordHeartbeat()` 调用
- 替换全部 `console.*` 为 `logger.*`

### [修改] `src/notifier/dingTalkNotifier.ts`
完全重写，替换不可用的 `dingtalk-stream` Robot。
- 改用 axios POST 到钉钉群机器人 Webhook（`DINGTALK_WEBHOOK_URL`）
- 发送 Markdown 格式消息，支持 `at.atUserIds`

### [修改] `src/notifier/index.ts`
- 集成 `logger`，记录邮件、钉钉通知的发送尝试与结果
- 修正环境变量访问为 `process.env['KEY']` 模式

### [修改] `src/index.ts`
集成所有新模块，完善启动流程。
- 启动顺序：状态面板 → LLM 连通测试 → Gateway（Heartbeat）→ 主消费循环
- 全面替换 `console.*` 为 `logger.*`
- 记录告警处理全生命周期事件及未捕获异常

### [修改] `.env`
配置自定义 OpenAI 兼容端点。
- `LLM_PROVIDER=openai-compatible`
- `LLM_MODEL=gpt-4o`
- `LLM_BASE_URL=https://openai.xuya.dev/v1`
- `STATUS_PORT=3000`、`HEARTBEAT_INTERVAL_SECONDS=30`

### [新增] `.env.example`
环境变量配置模板，包含所有变量说明及示例值（OpenAI、Anthropic、DeepSeek、Qwen、Azure、Ollama）。

### [修改] `.gitignore`
从 UTF-16 重写为 UTF-8，新增排除规则。
- 排除：`node_modules/`、`.env`、`.claude/`、`dist/`、`logs/`

### [修改] `package.json`
新增依赖：
- `openai: ^4.98.0`（多 provider LLM 支持）
- `express: ^5.2.1`（状态面板服务器）
- `@types/express`（开发依赖）

---

## 2026-04-22（PRIORITY-FLIP）— 告警等级语义翻转（P3 最严重）+ 经验沉淀精炼

### 背景
原约定 `P0=最严重、P3=最轻` 与现场运维团队"级别数字越大越严重"的习惯相反，且与上游 EMS 接口 `level="3"=一级告警`的语义不一致。本轮统一翻转为 **P3 最严重、P0 最轻**。

### [修改] `src/config/alarmPriority.ts`
- `ALARM_PRIORITY` 表全量翻转：`battery_smoke/fire_alarm/emergency_stop` 从 P0 → P3；`cell_voltage_high/cell_temp_high/insulation_error/pcs_communication_lost/pcs_grid_error` 从 P1 → P2；`soc_low/fan_error/comm_error` 从 P2 → P1。
- `PRIORITY_ORDER` 权重翻转：`P3:0, P2:1, P1:2, P0:3`（数值越小越先处理）。
- 头部注释重写为"P3 紧急 / P2 重要 / P1 一般 / P0 提示"。

### [修改] `src/index.ts`
- EXP-1 早退出分支：`P3 跳过 LLM` → `P0 跳过 LLM`。
- EXP-2 快速通道：`popByPriority('P0')` → `popByPriority('P3')`，局部变量 `p0 → p3`，日志文案同步。
- 主消费循环注释 "P1/P2/P3" → "P2/P1/P0"；未知类型 fallback `'P2'` → `'P1'`。

### [修改] `src/notifier/index.ts`
- 邮件/钉钉接收优先级从 `['P0','P1','P2']` → `['P3','P2','P1']`。
- 仅日志分支从 `P3 仅日志` → `P0 仅日志`。

### [修改] `src/server/statusServer.ts`
- 下拉选项翻转：`P3 紧急 / P2 重要 / P1 一般（默认选中）/ P0 提示`。
- `/api/test-alarm` fallback `'P2'` → `'P1'`。

### [修改] `src/tools/queryBms.ts`
- `toAlarmPriority` 的 map 保持数字对齐（`level="3"→P3`），但注释明示"P3 最严重"；unknown fallback `'P2'` → `'P1'`。

### [修改] `src/gateway/alarmQueue.ts`
- 排序注释 "P0 优先" → "P3 最严重最优先"；`popByPriority` JSDoc 中 P0 → P3。

### [重写] `KNOWLEDGE.md`
新增告警优先级语义表（含 EMS level 对照）+ **R1–R5 五条稳定推理规则**：
- **R1** 数据一致性前置校验（状态 vs 功率、分压和 vs 总压、PCS vs 电表）
- **R2** 定值未知时不下绝对结论
- **R3** 振荡/抖动模式优先识别（30秒内≥2次跳抖动分支）
- **R4** VF 状态三分类（保护跳闸 / 孤岛带载 / 标志位误置）
- **R5** 工具调用批量化（首轮并行拉全景上下文）
- SOP 翻转：P3 15 分钟响应、P0 仅入库。

### [重写] `self-improvement.md`
- 原 16+ 条按时间堆叠的零散建议 → 精炼版：**D1–D5 高频缺陷表**（每条 ≥2 案例）+ **I1–I5 核心改进方向**（引用 `KNOWLEDGE.md` 的 R1-R5）。
- 新增"最近增量案例（30 天）"区，等待聚类脚本追加。
- 顶部声明语义约定（P3 最严重），与历史旧语义矛盾的表述以新约定为准。

---

## 2026-04-22（RESILIENCE）— 韧性、审计、可观测性十项（E1/E2/E4/E5/E6/E7 + R2/R3/R4/R5）

### 背景
以"AI 数据修复工程师"和"AI 工程师"双视角对项目做评估，落地 10 项改进（未执行 R1 本地 provider 与 E3 降级策略，按用户指示保留云端单 provider）。

### [修改] `src/llm/client.ts` — E1 Prompt Caching + E5 可复现性 + R5 审计追踪
- **E1**：`callAnthropic` 将 system prompt 改为 `[{type:'text', text, cache_control:{type:'ephemeral'}}]` block 格式；从 `usage` 读 `cache_read_input_tokens` / `cache_creation_input_tokens` 入库。20 轮循环后 19 轮按 10% 价格命中，单告警成本降 ≥50%。
- **E5**：默认 `temperature=0.1`（可经 `LLM_TEMPERATURE` 覆盖）；OpenAI 路径传 `seed`（由 `alarmId` SHA-256 派生，同告警重跑稳定）。
- **R5**：每次调用计算 `promptHash = SHA-256(system prompt)` 入库；新增 `LlmCallResult` 返回类型（`LLMResponse & { stats }`），外层可读 `inputTokens / outputTokens / cacheReadTokens / cacheWriteTokens`。
- 失败调用也通过 `insertLlmCall` 写一条 `is_error=1` 的记录（保证"每次 LLM 调用都有回执"的审计铁律）。

### [修改] `src/runtime/agentLoop.ts` — E2 Token 熔断
- 构造器读 `LLM_MAX_TOKENS_PER_ALARM`（默认 200000）。
- `run()` 循环内维护 `cumulativeTokens += inputTokens + outputTokens`，每轮进入前检查，超限直接降级为"Token 用量达上限，请人工介入"文案并结束，防止复杂告警吞掉巨额费用。
- `runOnce` / `runSelfReflection` 同步改为使用 `LlmCallResult` 返回类型（去掉显式 `LLMResponse` 注解，走类型推断）。

### [修改] `src/runtime/toolRouter.ts` — R3 工具参数 schema 校验
- 新增 `validateToolArgs(toolName, args)`：从 `TOOLS_DEFINITION` 构建 `SCHEMA_MAP`；检查必填、类型（string/number/array）、数组成员类型、字符串长度上限（顶层 512、数组成员 256）。
- 执行前先校验，失败直接返回 `{ error, hint }`，不调 HTTP；校验函数 `export` 供单元测试。

### [修改] `src/db/database.ts` — R5/E4/E6 schema 迁移
- `llm_calls` 用 try/catch `ALTER TABLE ADD COLUMN` 方式新增 6 列：`prompt_hash TEXT`、`shadow_group TEXT DEFAULT 'prod'`、`cache_read_tokens INTEGER`、`cache_write_tokens INTEGER`、`tool_name TEXT`、`is_error INTEGER`。
- 老库零迁移成本自动升级。

### [修改] `src/db/llmCallRepository.ts`
- `insertLlmCall` 接口扩展：接受 `promptHash / shadowGroup / cacheReadTokens / cacheWriteTokens / toolName / isError`，全部写入 llm_calls。
- 新增 `queryLlmMetrics(sinceHours)`：总调用数、失败率、cache 命中率、distinct prompt_hash 数、平均耗时。
- 新增 `queryToolMetrics(sinceHours)`：按 `tool_name` 分组聚合失败率、平均延时。
- 新增 `queryShadowComparison(alarmId)`：按 `shadow_group` 拆分 prod / shadow 调用链，供 side-by-side UI。

### [修改] `src/db/alarmRepository.ts` — R2 崩溃恢复 + E6 延时分位
- 新增 `recoverStaleProcessingAlarms(staleMinutes)`：启动时把 >staleMinutes（默认 5）仍 `processing` 的告警强制置 `error`，避免进程崩溃导致记录永久滞留。
- 新增 `reconcileAlarmStates(sinceHours)`：对账 `total == done+error+processing`，不平衡时打 SEV1 日志。
- 新增 `queryAlarmLatencyPercentiles(sinceHours)`：按 `alarm_type` 聚合 P50/P95/P99 耗时（Node 侧分位计算）。

### [修改] `src/index.ts`
- 启动流程新增 R2 恢复扫描，读 `RECOVERY_STALE_MINUTES`（默认 5）。
- `processAlarm` 在主分析前 fire-and-forget 调用 `ShadowRunner.run(...)`（仅当 `SHADOW_ENABLED=true`）。

### [新增] `src/runtime/shadowRunner.ts` — E4 Shadow Mode
- `ShadowRunner.run(alarm, initialData)`：用主 LLM 单轮（无工具）跑一次候选 prompt，`shadow_group='shadow'` 入库，不发通知、不入 `alarm_records`。
- 候选 prompt 通过 `SHADOW_PROMPT_APPEND` env 追加到 system prompt 末尾，便于灰度验证新规则。

### [修改] `src/server/statusServer.ts`
新增 3 个端点：
- `GET /api/reconcile?hours=24` — R2 对账报告
- `GET /api/metrics?hours=24` — E6 一站式指标（llm + tools + latency + reconcile）
- `GET /api/shadow/compare?alarmId=xxx` — E4 prod vs shadow 对比

### [新增] `scripts/cluster-reflections.ts` — R4 聚类反哺 self-improvement
- **纯主 LLM 版**，复用 `LLMClient()`（等同主项目的 `LLM_PROVIDER / LLM_API_KEY / LLM_MODEL`），不调用任何 embedding 接口、不引入其他模型。
- 流程：拉近 30 天 `self_improvements` → 一次性给 LLM 聚类（输出 JSON `{clusters:[{theme, ids}]}`）→ 每簇再调一次 LLM 归纳成 D/I 规则 → 追加到 `self-improvement.md` 末尾。
- `npm run cluster-reflections` 触发；env：`CLUSTER_LOOKBACK_DAYS / CLUSTER_MAX_ITEMS / CLUSTER_MIN_SIZE`。

### [新增] `tests/` — E7 单元测试（vitest）
- `alarmQueue.test.ts`：P3 最严重排序、popByPriority、去重、processing 阻止入队（4 用例）
- `toolRouter.test.ts`：R3 校验逻辑（未知工具、必填、类型、数组、超长、对象非对象）（8 用例）
- `thresholds.test.ts`：SOC / 电压 / 频率 / 非数值 / 多越限（6 用例）
- `contextManager.test.ts`：消息顺序、tool_calls 序列化、tool_call_id 关联、system 不被 compact 丢失（4 用例）
- **合计 22 用例，全部通过**。

### [新增] `vitest.config.ts` + `.github/workflows/ci.yml`
- vitest 只包含 `tests/**/*.test.ts`。
- GitHub Actions：Node 20、`npm ci` → `tsc --noEmit` → `npm test`。

### [修改] `tsconfig.json`
- 补 `include: ["src/**/*.ts"]` 和 `exclude: [tests, scripts, vitest.config.ts]`，隔离测试文件与 `rootDir` 冲突。

### [修改] `package.json`
- 新增 scripts：`cluster-reflections`、`test`（vitest run）、`test:watch`。
- 移除旧 `test` 占位。
- devDependencies 加 `vitest`。

### [修改] `.env.example`
新增：
```
LLM_TEMPERATURE=0.1
LLM_MAX_TOKENS_PER_ALARM=200000
SHADOW_ENABLED=false
SHADOW_PROMPT_APPEND=
RECOVERY_STALE_MINUTES=5
CLUSTER_LOOKBACK_DAYS=30
CLUSTER_MAX_ITEMS=100
CLUSTER_MIN_SIZE=2
```

### 未执行（按用户要求）
- **R1** 本地 provider（PII 合规）— 用户确认沿用单一云端 LLM
- **E3** 降级策略（fallback provider / 规则兜底）— 暂不实施

### 验证
- `npx tsc --noEmit`：无错误
- `npm test`：4 文件 22 用例全部通过
- Schema 迁移采用 `ALTER TABLE ADD COLUMN` + try/catch，老库自动升级
