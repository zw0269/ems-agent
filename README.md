# EMS Agent - 储能系统 AI 运维代理

> 基于大语言模型的储能设备故障分析与根因定位系统

## 项目简介

EMS Agent 是一个智能化的储能系统运维代理，通过 LLM（大语言模型）自动分析 PCS（功率转换系统）、BMS（电池管理系统）的告警数据，提供根因分析和操作建议。

**核心能力**：
- 🤖 **智能推理**：基于 Claude/GPT 等大模型的多轮推理分析
- 🔍 **根因定位**：自动识别告警根因（硬件故障/软件配置/采样偏差）
- 📊 **数据交叉验证**：PCS 采样 vs 电表采样，母线电压自洽性校验
- 🎯 **故障模式识别**：预置 6 种典型故障模式决策树
- 📈 **自我改进**：每次分析后自动反思，持续优化推理质量
- 🔔 **多渠道通知**：邮件 + 钉钉双重通知，P3 告警快速通道

## 技术栈

- **运行时**：Node.js 18+ / TypeScript 6.0.2
- **LLM 集成**：Anthropic Claude / OpenAI / 兼容 API
- **数据库**：SQLite (better-sqlite3)
- **通知**：Nodemailer (SMTP) / 钉钉群机器人
- **状态面板**：Express HTTP 服务器

## 快速开始

### 1. 环境要求

- Node.js >= 18.0.0
- npm 或 yarn
- EMS Java 后端可访问（提供设备数据接口）

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

**必填配置**：

```bash
# LLM Provider 配置
LLM_PROVIDER=anthropic              # anthropic | openai | openai-compatible
LLM_API_KEY=sk-ant-...              # 你的 API Key
LLM_MODEL=claude-opus-4-6           # 模型名称

# EMS Java 后端
EMS_BASE_URL=http://192.168.1.100:8080

# 邮件通知（SMTP）
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your@qq.com
SMTP_PASSWORD=your_auth_code       # QQ邮箱授权码
SMTP_FROM_NAME=EMS Agent 告警

# 钉钉通知（群机器人 Webhook）
DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx

# 通知对象
OPERATOR_EMAILS=ops1@company.com,ops2@company.com
OPERATOR_DINGTALK_IDS=user_001,user_002
```

**可选配置**：

```bash
# Token 熔断（默认 200000）
LLM_MAX_TOKENS_PER_ALARM=200000

# 采样温度（默认 0.1，越低越稳定）
LLM_TEMPERATURE=0.1

# 心跳轮询间隔（默认 30 秒）
HEARTBEAT_INTERVAL_SECONDS=30

# 状态面板端口（默认 3000）
STATUS_PORT=3000
```

### 4. 启动服务

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm start

# 构建 TypeScript
npm run build
```

### 5. 访问状态面板

启动后访问：http://localhost:3000

**功能**：
- 实时告警队列监控
- LLM 调用统计（Token 用量、缓存命中率）
- 历史告警列表与详情查看
- 手动注入测试告警
- AI 自我改进建议审核

## 项目结构

```
ems-agent/
├── src/
│   ├── config/           # 配置：阈值、字段映射、告警优先级、保护定值标准
│   ├── db/               # 数据库：SQLite 操作、Repository 模式
│   ├── gateway/          # 网关：心跳轮询、告警队列、会话管理
│   ├── llm/              # LLM：客户端封装、提示词
│   ├── notifier/         # 通知：邮件、钉钉
│   ├── runtime/          # 运行时：Agent 循环、工具路由、上下文管理
│   ├── server/           # 状态面板：Express HTTP 服务器
│   ├── tools/            # 工具：查询 EMS 后端（11 个工具函数）
│   ├── types/            # TypeScript 类型定义
│   ├── utils/            # 工具函数：日志、健康检查
│   └── index.ts          # 主入口
├── data/                 # SQLite 数据库文件
├── logs/                 # 日志文件（按日期分割）
├── scripts/              # 脚本：聚类反思
├── llm-ai/               # AI 协作文档（代码索引、样式、体检记录）
├── KNOWLEDGE.md          # 领域知识库（热加载）
├── self-improvement.md   # AI 自我改进积累（热加载）
├── CLAUDE.md             # AI 协作规范
└── README.md             # 本文件
```

## 核心特性

### 1. 告警优先级（P3 最严重）

| 优先级 | 含义 | 处理策略 |
|---|---|---|
| **P3** | 紧急 / 一级，可能设备损坏或安全事故 | 快速通道（200ms 轮询）+ 邮件 + 钉钉 |
| **P2** | 重要 / 二级，影响系统运行 | 主队列 + 邮件 + 钉钉 |
| **P1** | 一般 / 三级，需关注 | 主队列 + 邮件 + 钉钉 |
| **P0** | 提示 / 四级，仅日志 | 跳过 LLM，直接入库记录 |

> 注意：本工程中 **P3 严重度最高**，与部分业界"P0=最高"的约定相反。

### 2. 数据一致性校验（R1）

每次推理前自动执行三项自洽检查：

1. **状态 vs 功率/电流方向**：停机但有 >10A 电流 → 信号链故障
2. **母线电压内部一致性**：UpVol + DownVol 与 TotalDirectVol 偏差 >5% → 采样配置错误
3. **PCS 采样 vs 电表采样**：偏差 >10% → CT/PT 变比/接线问题

### 3. 典型故障模式决策树

预置 6 种典型故障模式识别规则：

- **运行态告警**：设备正常但有告警 → 定值配置/采样偏差
- **VF 离网振荡**：高频反复触发 → 定值死区过小/接触器抖动
- **状态矛盾**：总故障正常但有 P1 告警 → 配置逻辑错误
- **电压不匹配**：三级排查路径（采样故障 → 参数标定 → 硬件预充电）
- **VF 离网三分类**：停机/孤岛带载/标志位误置
- **停机态电压异常**：物理模型修正（无调制比例关系）

### 4. 保护定值标准库（GB/T 19964）

内置并网标准阈值：

- **交流电压**：260-270V 过压，185-190V 欠压
- **频率**：49.5-50.5Hz 正常运行范围
- **直流电压**：950-1000V 过压（1000V 系统）
- **电压不平衡度**：>2% 触发保护

### 5. 操作建议风险分级

所有操作建议按风险等级分类输出：

- **优先级 1：不停机远程核查**（定值核对、趋势分析）
- **优先级 2：需停机电测**（采样回路、绝缘测试）
- **禁止操作**：电流异常时禁止重启、单次告警禁止调整定值

### 6. 迭代熔断机制

- 最大迭代次数：5 次（从 20 次优化）
- Token 熔断：单条告警累计 200000 token 上限
- 降级策略：输出已完成排查项，而非简单报错

## 工作流程

```
1. EMS Java 后端产生告警
     ↓
2. Heartbeat 轮询 getRealTimeAlarms() 获取
     ↓
3. AlarmQueue.push() 入队（P3 → 快速通道，P2/P1/P0 → 主队列）
     ↓
4. processAlarm() 消费
     ├─ 并行采集：getHomePage() + getBmsYx() + getPcsYc() + getPcsYx() + getMeterYc()
     ├─ 并行采集：getHistoryAlarms()
     ├─ checkThresholds() 阈值检查（含 R1 数据一致性校验）
     ├─ insertRealtimeSnapshot() 存快照
     └─ AgentLoop.run() 进入推理循环
          ├─ LLMClient.call() 第 1 轮
          │    └─ 返回 tool_use（如 getPcsYx）
          ├─ ToolRouter.execute() 执行工具
          │    └─ axios.get(EMS_BASE_URL + '/api/pcs/yx')
          ├─ LLMClient.call() 第 2 轮（带工具结果）
          │    └─ 返回 tool_use（如 getMeterYc）
          ├─ ... 循环最多 5 次或达到 token 上限
          └─ 最终返回 text 结论
     ↓
5. notifyOperator() 发送邮件 + 钉钉
     ↓
6. updateAlarmFinished() 更新数据库状态
```

## 开发指南

### 运行测试

```bash
npm test              # 运行测试
npm run test:watch    # 监听模式
```

### 代码规范

- **命名**：camelCase（文件/函数/变量）、PascalCase（类）、UPPER_SNAKE_CASE（常量）
- **导入**：必须加 `.js` 扩展名（ESM 要求）
- **类型**：优先使用命名导出，避免 `any`（动态数据除外）
- **错误处理**：顶层 try-catch + process 事件监听

详见 `llm-ai/代码样式.md`

### AI 协作

本项目已配置 AI 协作规范，详见 `CLAUDE.md`。

**核心原则**：
- 分级自评审（L1-L5）
- 踩坑登记（error-*.md）
- 影响半径判级
- 根目录洁癖（md 必入 llm-ai/）
- 索引轻量闭环

## 数据库表结构

- **alarm_records**：告警记录（ID、类型、优先级、状态、结论、耗时）
- **llm_calls**：LLM 调用记录（输入输出、token 统计、审计追踪）
- **realtime_snapshots**：实时数据快照（每次告警采集的设备数据）
- **self_improvements**：AI 自我改进建议（用户反馈、聚合去重）
- **ems_alarms**：EMS 告警数据（工具调用返回的历史告警）

## 常见问题

### Q1: 如何切换 LLM Provider？

修改 `.env` 中的 `LLM_PROVIDER` 和 `LLM_API_KEY`：

```bash
# 使用 Anthropic Claude
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-opus-4-6

# 使用 OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o

# 使用兼容 API（如 DeepSeek）
LLM_PROVIDER=openai-compatible
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com/v1
```

### Q2: 如何调整迭代次数？

修改 `src/runtime/agentLoop.ts` 中的 `maxIterations`（默认 5 次）。

### Q3: 如何查看 LLM 调用详情？

访问状态面板 http://localhost:3000，点击"LLM 调用"标签页。

### Q4: 如何手动注入测试告警？

访问状态面板 http://localhost:3000，点击"手动注入"按钮。

### Q5: 如何更新领域知识库？

直接编辑 `KNOWLEDGE.md` 文件，无需重启服务（热加载）。

## 性能指标

- **迭代次数**：平均 ≤2 次（优化前 6 次）
- **Token 用量**：单条告警平均 50k-100k（上限 200k）
- **响应时间**：P3 告警 <30 秒，P2/P1 告警 <60 秒
- **准确率**：根因定位准确率 >85%（基于 19 条历史案例优化）

## 贡献指南

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交改动 (`git commit -m 'feat: Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

**Commit 规范**：

```
<type>(<scope>): <subject>

type: feat | fix | refactor | docs | chore | style | test
scope: 模块名（如 llm, gateway, db）
subject: 简短描述（中文）
```

## 许可证

本项目采用 ISC 许可证。

## 联系方式

- **作者**：Zw
- **邮箱**：Zw0269@foxmail.com
- **问题反馈**：[GitHub Issues](https://github.com/your-repo/ems-agent/issues)

## 致谢

- [Anthropic Claude](https://www.anthropic.com/) - 提供强大的 LLM 能力
- [OpenAI](https://openai.com/) - GPT 模型支持
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - 高性能 SQLite 驱动

---

**版本**：v1.0.0  
**最后更新**：2026-05-02
