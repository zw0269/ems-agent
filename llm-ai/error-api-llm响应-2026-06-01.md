# error-api-llm响应 · 网关非 OpenAI 响应致 LLMClient 崩溃（reading '0'）

> 首次记录 2026-06-01 ｜ scope: api ｜ 状态: 代码已加固；可用端点待定

## 现象

启动时 LLM 连通性测试每次失败，三次重试均报：
`Cannot read properties of undefined (reading '0')`（provider=openai，model=gpt-5.5，
baseURL=https://api.freemodel.dev/v1）。

## 根因（两层）

1. **代码层**：`src/llm/client.ts:262` `raw.choices[0]?.message` —— `?.` 在 `[0]` 之后，
   当网关返回**不含 choices 的响应体**（非 OpenAI 兼容 / 错误体）时，`raw.choices` 为
   undefined，`raw.choices[0]` 先抛 "reading '0'"，下一行 `if(!message)` 成了死代码。
   即：把"网关返回异常体"这一可诊断问题，变成了不可诊断的崩溃。
2. **配置/端点层**：baseURL 用了错误主机 `api.freemodel.dev/v1`；正确主机是
   `cc.freemodel.dev`。但**该网关不对外提供原始 API 补全**：
   - `GET /v1/models` → 200，列出 claude-opus-4-8/4-7/4-6 · claude-sonnet-4-6 · claude-haiku-4-5；
   - `POST /v1/chat/completions`（OpenAI 风格）→ **HTTP 305 "Service Unavailable"**（sonnet/opus 均如此，多次稳定复现）；
   - `POST /v1/messages`（原生 Anthropic）→ 200 但正文 `"Please use Claude Code CLI"`；
   - `gpt-5.5` 直接 400「模型暂不支持」。
   结论：此网关面向 **Claude Code CLI** 使用，ems-agent 直连 SDK 拿不到补全。

## 修复

- **代码加固**（已做）：抽出 `export function firstChoiceMessage(raw)`，缺 `choices[0].message`
  时抛出**含响应体片段**的可诊断错误（`OpenAI 兼容响应缺少 choices[0].message…: <body>`），
  替换 client.ts:262 的裸索引。单测 `tests/llmClientParse.test.ts`（3 例）+ tsc 通过。
- **配置**（待用户提供可用端点）：需要一个真正对外提供 OpenAI 兼容 `/v1/chat/completions`
  或原生 `/v1/messages` 补全的端点/密钥；当前 cc.freemodel.dev 仅 `/v1/models` 可用。
  正确则配：`LLM_PROVIDER=openai`、`LLM_BASE_URL=<可用端点>/v1`、`LLM_MODEL=<网关支持的模型>`、`LLM_API_KEY=<key>`。

## 验证

- 单测：网关错误体（无 choices）→ 抛含响应体的可诊断错误，不再 "reading '0'"。
- 实测：curl cc.freemodel.dev —— /v1/models 200；chat/completions 305；/v1/messages "Please use Claude Code CLI"。

## 迭代记录

- 2026-06-01 首次记录：代码加固完成；可用补全端点待定。
