# EMS Agent 知识沉淀文档

## 核心点位说明 (CORE_FIELDS)

| 点位 Key | 含义 | 单位 | 备注 |
|---|---|---|---|
| bms_total_voltage | 总电压 | V | 监控整簇电压，判断充电上限 |
| bms_total_current | 总电流 | A | 正值为充电，负值为放电 |
| bms_soc | 荷电状态 | % | 剩余容量比例 |
| bms_max_cell_voltage | 最高单体电压 | V | 保护单体不被过充，阈值 3.65V |
| bms_min_cell_voltage | 最低单体电压 | V | 保护单体不被过放，阈值 2.8V |
| pcs_charge_limit | 充电功率限制 | kW | PCS 侧设置的充电上限 |

## 额外点位逻辑 (EXTRA_FIELDS)

- **cell_voltage_high**: 需要额外查看 `bms_cell_voltages`（所有单体电压）和 `pcs_charge_limit`，判断是否为个别电芯失控或 PCS 整体过充。
- **cell_temp_high**: 需要联动 `cooling_system_status`（冷却系统状态），判断是产热过大还是散热失效。

## LLM 提示词迭代记录

- **v1.0 (Initial)**: 分离硬件和软件分析。硬件走单次报告，软件走 Agent Loop 循环推理。
- **改动原因**: 硬件故障通常不可由软件配置修复，进循环会浪费 Token 且增加误判风险。

## 故障处理 SOP

1. **P0/P1 告警**: 触发钉钉 + 邮件双重通知，运维人员需在 15 分钟内响应。
2. **P2 告警**: 触发邮件通知，运维人员需在 4 小时内处理。
3. **P3 告警**: 记录日志，仅作为日报参考。
