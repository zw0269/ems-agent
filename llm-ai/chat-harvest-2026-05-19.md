---
date: 2026-05-19
source: ai-chat
topic: EMS Agent 产品迭代 — 钉钉报告优化 + 大厂对标三件套
tags: [ems-agent, ai-agent, aiops, prompt-engineering, mcp]
---

# 对话提炼 — EMS Agent 产品迭代（钉钉报告优化 + 大厂对标）

## ✅ 可复用的方法
- 告警去重指纹：`hash(类型 + 设备 + 5min桶)` 命中即跳 LLM 复用结论，适用任何高频重复事件场景
- 多 Agent 复核的轻量化做法：仅最高优先级触发 Verifier，失败静默回退原结论，避免成本翻倍
- LLM 输出"结构化优先 + 兜底"链路：markdown 加标签 → 下游 regex 提取关键段 → 失败再用字节截断兜底

## 📌 值得记录的知识点
- 钉钉 markdown text 字段上限约 4000 字节，超过会被截断成乱码（项目实测设 3800 留余量）
- better-sqlite3 没有 `IF NOT EXISTS COLUMN`，迁移加列只能 `try { ALTER ADD COLUMN } catch {}`
- MCP SDK 1.29 stdio 模式：stdout 是协议通道，日志只能走 stderr，否则破坏 JSON-RPC 协议

## 🔭 待探索的方向
- 拓扑感知 / 因果图谱（对标 Datadog Service Map）：建模设备间告警传递性
- 执行剧本 / Runbooks（对标 PagerDuty）：把操作建议关联到 markdown checklist，运维可勾选完成度
- MCP 反向接入：让本项目 Agent 作为 MCP client 调外部工具（Web 搜索 / 文档库），现在只暴露 server 端

## 💬 我的判断与倾向
- 经验沉淀偏好手工编写，不信任 LLM 自动总结质量（在"种子生成方式"二选一时主动选"手工编写"）
- 多通道分级输出：钉钉只发精简摘要、邮件发完整、Web 面板带完整审计链路
- 工作模式偏好 ultrathink + 第一性原理 + 对标大厂（用户原话："使用ultrathink模式，使用第一性原理理解我的问题"）
