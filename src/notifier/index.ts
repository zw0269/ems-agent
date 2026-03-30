import { EmailNotifier } from './emailNotifier.js';
import { DingTalkNotifier } from './dingTalkNotifier.js';
import type { Alarm } from '../types/index.js';

const email = new EmailNotifier();
const dingtalk = new DingTalkNotifier();

/**
 * 统一通知入口
 * 根据告警优先级执行不同的通知策略
 */
export async function notifyOperator(alarm: Alarm, conclusion: string) {
  const subject = `【${alarm.priority}】EMS 告警分析报告 - ${alarm.alarmType}`;
  
  const operatorEmails = process.env.OPERATOR_EMAILS?.split(',') || [];
  const operatorDingTalkIds = process.env.OPERATOR_DINGTALK_IDS?.split(',') || [];

  // P0/P1/P2 发送邮件
  if (['P0', 'P1', 'P2'].includes(alarm.priority)) {
    if (operatorEmails.length > 0) {
      await email.send({
        to: operatorEmails,
        subject,
        body: conclusion,
      });
    }
  }

  // P0/P1 额外发送钉钉（双推）
  if (['P0', 'P1'].includes(alarm.priority)) {
    if (operatorDingTalkIds.length > 0) {
      await dingtalk.send({
        userIds: operatorDingTalkIds,
        title: subject,
        content: conclusion,
      });
    }
  }

  // P3 仅记录日志
  if (alarm.priority === 'P3') {
    console.log(`[Notify] P3 告警记录: ${subject}\n${conclusion}`);
  }
}
