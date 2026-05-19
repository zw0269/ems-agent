/**
 * 经验种子注入（一次性，幂等可重跑）
 *
 * 作用：把 self-improvement.md 里 19 条历史案例提炼成结构化的三段格式种子，
 *      写入 alarm_records 表（is_test=2），按 alarmType 做 few-shot 注入用。
 *
 * 设计：
 *  - alarm_id 用 SEED-<case-id> 形式，INSERT OR IGNORE 幂等
 *  - is_test=2 标记，列表 API 与统计 SQL 默认排除
 *  - alarm_type 与 EMS 后端推送的实际值匹配（若不匹配可调整下方 SEEDS 数组）
 *
 * 运行：npx tsx scripts/seed-experience-cases.ts
 *
 * 校验：
 *   sqlite3 <db路径> "SELECT alarm_type, COUNT(*) FROM alarm_records WHERE is_test=2 GROUP BY alarm_type;"
 */
import 'dotenv/config';
import { getDb } from '../src/db/database.js';

interface SeedCase {
  alarm_id: string;
  alarm_type: string;
  fault_category: 'software' | 'hardware';
  device_id: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  timestamp: string;
  conclusion: string;
}

/**
 * 13 条种子案例，覆盖 5 大类典型故障模式
 *
 * 注：alarm_type 字符串需与 EMS 后端推送的实际值完全匹配；
 *    若实际推送为英文 snake_case 或其他形式，可在此调整后重跑。
 */
const SEEDS: SeedCase[] = [
  // ─── PCS 交流过压（运行态告警） ─────────────────────────────────
  {
    alarm_id: 'SEED-PCS-AC-OV-001',
    alarm_type: 'PCS交流相电压过压',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-10 10:00:00',
    conclusion: `**根因**：运行态触发过压告警但实测电压在预警区间内，高度疑似保护定值过敏或采样回路偏差。

**证据链**：
- pcsAcVoltage=243V → 仅超 242V 预警上限 1V，远低于 260V 真过压触发线
- pcsOperatingStatus=运行 + pcsOverallFaultStatus=false → 设备本体正常
- 未读取到 pcs_ov_threshold 寄存器 → 无法直接验证定值是否被改

**操作建议**：
- [远程核查] 读取 PCS 过压保护定值寄存器与回差，确认是否被改至预警区间
- [远程核查] 调取 ±60s 趋势曲线，确认是否为采样毛刺
- [人工现场] 若定值正常，检查 PT 二次接线松动与屏蔽接地`,
  },

  // ─── PCS 直流过压（临界） ──────────────────────────────────────
  {
    alarm_id: 'SEED-PCS-DC-OV-001',
    alarm_type: 'PCS直流过压',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-01 07:35:06',
    conclusion: `**根因**：临界直流过压告警，BMS 与 PCS 两路采样未交叉验证，存在阈值误报或真实过充两种可能（≤50% 各占）。

**证据链**：
- pcsTotalDirectVol=946.7V，pcsInputVoltage=869.4V → 两值偏差 77V (~9%)
- batteryVoltage(BMS)=950V → 与 PCS 直压偏差 3.3% 可接受
- 行业典型直流过压阈值 950-1000V → 946.7V 处于临界触发区
- 未读取 pcs_dc_ov_threshold → 无法判定是否阈值被改

**操作建议**：
- [远程核查] 读取 PCS 直流过压定值并核对 BMS 充电上限，确认逻辑闭环
- [远程核查] 对比 BMS 总压 vs PCS 直压历史曲线，判断是否存在系统性采样偏差
- [停机电测] 万用表实测 PCS 直流端电压，与采样值比对`,
  },

  // ─── PCS 电压不匹配（R1.2 母线不自洽） ───────────────────────
  {
    alarm_id: 'SEED-PCS-VMISMATCH-001',
    alarm_type: 'PCS电压不匹配',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-01 07:35:26',
    conclusion: `**根因**：直流母线分压采样系数错误，UpVol+DownVol 与 TotalDirectVol 算术不符（R1.2 触发），优先判定为采样链路问题而非物理过压。

**证据链**：
- pcsUpVol=525V + pcsDownVol=431.2V = 956.2V
- pcsTotalDirectVol=842.2V → 差值 114V (偏差 13.5%) 远超 5% 容差
- 内部三路采样自相矛盾 → 排除物理电压问题
- batteryVoltage 一致性可作交叉验证

**操作建议**：
- [远程核查] 读取直流采样系数寄存器，核对 UpVol/DownVol/TotalDirectVol 三路配置
- [远程核查] 检查通讯解析是否将寄存器地址映射错位
- [停机电测] 万用表实测 UpVol/DownVol 端子电压，验证采样准确性`,
  },

  // ─── PCS 电压不匹配（R1.3 PCS vs 电表） ──────────────────────
  {
    alarm_id: 'SEED-PCS-VMISMATCH-002',
    alarm_type: 'PCS电压不匹配',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:08:17',
    conclusion: `**根因**：PCS 与电表同点位电压偏差超 30%，高概率（90%）为 CT/PT 变比设置错误或二次接线问题（R1.3 触发）。

**证据链**：
- pcsAcVoltage=215V, meterVoltageA=174V → 偏差 41V (~24%) 远超 10% 容差
- 电网频率与三相平衡正常 → 排除电网侧问题
- 同一并网点两路独立采样不一致 → 物理上不可能，必为采样问题

**操作建议**：
- [远程核查] 核对 PCS 与电表的 CT/PT 变比配置，确认与硬件铭牌一致
- [停机电测] 检查 PT 二次接线端子松动、屏蔽层接地、采样板零点漂移
- [人工现场] 量程档位与采样卡型号对比，确认与设计文档一致`,
  },

  // ─── VF 离网（状态矛盾, R1.1） ────────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-001',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-07 11:53:52',
    conclusion: `**根因**：设备遥信"备用"但电池存在 116A 级电流，状态采样与功率方向矛盾（R1.1 触发），优先判为状态遥信失效，禁止做硬件根因假设。

**证据链**：
- pcsOperatingStatus=备用 (4)，batteryCurrent=-116.2A，batteryPower=-100kW 级别
- 备用态物理上不应有功率交换 → 状态遥信或负载侧逻辑异常
- pcsOverallFaultStatus=false → 设备本体无故障

**操作建议**：
- [远程核查] 读取状态字寄存器，核对运行状态字段定义与位映射
- [远程核查] 检查接触器辅助触点反馈与负载闭锁信号链路
- [人工现场] 现场确认接触器实际位置，与遥信状态比对`,
  },

  // ─── VF 离网（振荡 R3） ───────────────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-002',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:07:21',
    conclusion: `**根因**：30 秒内 14 次以上并离网循环（R3 触发），优先判为保护定值死区过小或采样回路抖动，禁止进入硬件故障树。

**证据链**：
- 历史告警 14 次/26 秒触发-恢复，每次持续 1-2 秒
- pcsAcVoltage / pcsAcFrequency 在每次触发后均自动回归正常范围
- 能自动恢复 → 设备硬件无损伤

**操作建议**：
- [远程核查] 读取频率/电压保护回差 dead_band，确认死区是否 < GB/T 19964 建议值 0.1Hz
- [远程核查] 调取告警时刻 ±60s 高分辨率波形，判断是否存在采样毛刺
- [停机电测] 检查二次侧屏蔽层接地、接触器辅助触点是否抖动`,
  },

  // ─── VF 离网（孤岛带载 R4 ②） ─────────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-003',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:08:41',
    conclusion: `**根因**：PCS 进入 VF 孤岛带载模式（R4 子类②），属正常电网故障穿越，不是设备故障，禁止建议"强制停机"。

**证据链**：
- pcsVfOffGridStatus=true，pcsOperatingStatus=运行，pcsOutputActivePowerTotal=21.9kW
- pcsOverallFaultStatus=false，pcsControlSoftwareFaultWord1-5 全 0
- 有功输出明显 + 无故障字 → 主动孤岛带载特征

**操作建议**：
- [远程核查] 确认本地孤岛保电策略与负载优先级配置
- [远程核查] 监测电网电压恢复情况，评估并网回切时机
- [人工现场] 不建议任何强制停机操作；按调度指令安排回切并网`,
  },

  // ─── VF 离网（VF 标志位误置 R4 ③） ────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-004',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:07:49',
    conclusion: `**根因**：VF 离网标志位误置（R4 子类③），总故障=0、软件故障字全 0，状态采样链或 IO 配置异常，非真实物理离网。

**证据链**：
- pcsVfOffGridStatus=true，但 pcsOverallFaultStatus=false
- pcsControlSoftwareFaultWord1-5 全为 0，pcsCommSoftwareFaultWord1-2 全为 0
- 电网三相电压/频率正常，外部条件无故障

**操作建议**：
- [远程核查] 读取 VF 状态字寄存器映射，确认位定义与硬件 IO 一致
- [远程核查] 检查 Remote/Local 控制位与就地旋钮反馈链路
- [停机电测] 检查 IO 板辅助触点接触电阻、中间继电器抖动`,
  },

  // ─── VF 离网（电网扰动） ──────────────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-005',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:06:28',
    conclusion: `**根因**：电网频率/电压短时扰动触发离网保护，告警持续 1-2 秒后自动恢复，属电网侧问题非设备故障。

**证据链**：
- pcsAcFrequency 触发时段瞬时跌至 49.4Hz (下限 49.5Hz)
- 设备触发并网点保护 → 立即孤岛 → 1.5s 后频率回升至 50.02Hz 自动并网恢复
- meterAcFrequency 与 pcsAcFrequency 同步波动 → 排除采样问题

**操作建议**：
- [远程核查] 调取并网点电能质量监测装置历史曲线，确认电网扰动幅度
- [远程核查] 评估保护定值回差是否过小导致敏感触发
- [需电网公司审批] 如需放宽频率保护定值，必须确认在 GB/T 19964 范围内`,
  },

  // ─── VF 离网（采样偏差 R1.3 极端） ────────────────────────────
  {
    alarm_id: 'SEED-VF-OFFGRID-006',
    alarm_type: 'VF离网',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-19 06:08:17',
    conclusion: `**根因**：PCS 与电表电压偏差 30% 以上触发误动作，90% 可能为 CT/PT 变比或二次接线问题。

**证据链**：
- pcsAcVoltage=95.7V，meterVoltageA=174.4V → 偏差 78.7V (~45%)
- 电表数据在国标 198-242V 区间正常 → 电网无故障
- pcsOperatingStatus 在告警瞬间从"运行"转"停机"，对应保护动作

**操作建议**：
- [远程核查] 核对 PCS 采样 CT/PT 变比配置（90% 嫌疑点）
- [停机电测] 万用表实测端子电压，对比采样值
- [停机电测] 检查二次接线松动、屏蔽接地不良`,
  },

  // ─── 交直流电压不匹配（停机态物理模型） ───────────────────────
  {
    alarm_id: 'SEED-AC-DC-MISMATCH-001',
    alarm_type: '交直流电压不匹配',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-28 17:15:58',
    conclusion: `**根因**：停机态（operatingStatus=4）下交直流电压不存在调制比例关系，告警逻辑错误使用运行态公式判定。

**证据链**：
- pcsOperatingStatus=4 (停机)，pcsOutputActivePowerTotal=0kW
- pcsAcVoltage=239V (电网电压)，pcsTotalDirectVol=571.6V (母线电压)
- 停机时交流=电网、直流=母线，二者独立无调制关系
- pcsControlSoftwareFaultWord4=4 → 软件保护误判触发

**操作建议**：
- [远程核查] 读取 PCS 软件版本与停机态保护屏蔽配置，确认逻辑是否包含调制关系误算
- [远程核查] 调取 SOE 事件顺序，区分"先停机后误判"还是"电压异常导致停机"
- [需电网公司审批] 如需修改停机态保护逻辑参数，需厂家与电网公司双方确认`,
  },

  // ─── 交直流电压不匹配（Token 超限教训） ───────────────────────
  {
    alarm_id: 'SEED-AC-DC-MISMATCH-002',
    alarm_type: '交直流电压不匹配',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-04-28 17:31:04',
    conclusion: `**根因**：BMS 与 PCS 直流母线建压不一致，差值 33%-37%，疑似预充失败或采样配置错误，非真实物理过压。

**证据链**：
- batteryVoltage(BMS)=864.8V，pcsTotalDirectVol=571.6V，pcsInputVoltage=540.9V
- 三路偏差 33%-37%，远超 R1.2 / R1.3 容差
- pcsCapacitorUpVol+DownVol≈TotalDirectVol → PCS 内部采样自洽
- 异常发生在 BMS↔PCS 链路，非 PCS 内部

**操作建议**：
- [远程核查] 检查直流接触器、预充接触器辅助触点与启动命令状态
- [远程核查] 读取近期参数下发与软件升级记录，确认直流采样系数未被改
- [停机电测] 隔离直流侧后实测电池侧 vs PCS 输入端电压，定位物理断点`,
  },

  // ─── 总故障状态（高频钉钉报告类型） ───────────────────────────
  {
    alarm_id: 'SEED-PCS-OVERALL-FAULT-001',
    alarm_type: '总故障状态',
    fault_category: 'software',
    device_id: 'SEED-PCS01',
    priority: 'P1',
    timestamp: '2026-05-19 09:42:44',
    conclusion: `**根因**：停机态下软件控制故障字 Word4=4 触发的交直流电压不匹配保护，偏向软件保护逻辑误判而非真实物理故障。

**证据链**：
- pcsOperatingStatus=4 + pcsOverallFaultStatus=true + pcsControlSoftwareFaultWord4=4
- 其他软件故障字 Word1/2/3/5=0，通讯故障字全 0 → 故障源单一明确
- 直流侧 BMS 864.8V vs PCS 母线 571.6V 偏差 33% → 数据链路问题特征
- 三相电压均在 239V 正常区，电表交叉验证一致 → 排除电网

**操作建议**：
- [远程核查] 读取 PCS 故障字位定义，确认 Word4=4 对应的具体保护逻辑
- [远程核查] 调取 SOE 与故障录波，确认故障发生顺序与预充/接触器动作序列
- [人工现场] 检查直流接触器、预充电阻、保险与接触器辅助触点反馈链路
- [需电网公司审批] 如涉及保护定值修改，必须符合 GB/T 19964 并报送审批`,
  },
];

function seed() {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO alarm_records
      (alarm_id, alarm_type, fault_category, device_id, priority,
       alarm_timestamp, started_at, finished_at, duration_ms, status, conclusion, is_test)
    VALUES
      (@alarm_id, @alarm_type, @fault_category, @device_id, @priority,
       @timestamp, @timestamp, @timestamp, 0, 'done', @conclusion, 2)
  `);

  let inserted = 0;
  let skipped = 0;
  for (const s of SEEDS) {
    const result = stmt.run(s);
    if (result.changes > 0) inserted++;
    else skipped++;
  }

  console.log(`[Seed] 注入 ${inserted} 条新种子，跳过 ${skipped} 条已存在记录（共 ${SEEDS.length} 条）`);

  const distribution = db.prepare(`
    SELECT alarm_type, COUNT(*) AS count
    FROM alarm_records
    WHERE is_test = 2
    GROUP BY alarm_type
    ORDER BY count DESC
  `).all() as Array<{ alarm_type: string; count: number }>;

  console.log('[Seed] 种子分布:');
  for (const row of distribution) {
    console.log(`  ${row.alarm_type.padEnd(24)} ${row.count}`);
  }
}

seed();
