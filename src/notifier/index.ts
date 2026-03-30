import { EmailNotifier } from './emailNotifier.js';
import { DingTalkNotifier } from './dingTalkNotifier.js';
import type { Alarm } from '../types/index.js';
import { logger } from '../utils/logger.js';

const email    = new EmailNotifier();
const dingtalk = new DingTalkNotifier();

/**
 * 统一通知入口
 * 根据告警优先级执行不同通知策略，每次发送均写入日志
 */
export async function notifyOperator(alarm: Alarm, conclusion: string) {
  const subject = `【${alarm.priority}】EMS 告警分析报告 - ${alarm.alarmType}`;
  const operatorEmails      = process.env['OPERATOR_EMAILS']?.split(',').filter(Boolean) ?? [];
  const operatorDingTalkIds = process.env['OPERATOR_DINGTALK_IDS']?.split(',').filter(Boolean) ?? [];

  logger.info('Notifier', '准备发送通知', {
    alarmId: alarm.alarmId,
    priority: alarm.priority,
    alarmType: alarm.alarmType,
  });

  // P0 / P1 / P2 → 邮件
  if (['P0', 'P1', 'P2'].includes(alarm.priority) && operatorEmails.length > 0) {
    const t0 = Date.now();
    try {
      await email.send({ to: operatorEmails, subject, body: conclusion });
      logger.info('Notifier', '邮件发送成功', {
        alarmId: alarm.alarmId,
        to: operatorEmails,
        durationMs: Date.now() - t0,
      });
    } catch (err: unknown) {
      logger.error('Notifier', '邮件发送失败', {
        alarmId: alarm.alarmId,
        error: (err as Error).message,
        durationMs: Date.now() - t0,
      });
    }
  }

  // P0 / P1 → 钉钉（双推）
  if (['P0', 'P1'].includes(alarm.priority) && operatorDingTalkIds.length > 0) {
    const t0 = Date.now();
    try {
      await dingtalk.send({ userIds: operatorDingTalkIds, title: subject, content: conclusion });
      logger.info('Notifier', '钉钉通知发送成功', {
        alarmId: alarm.alarmId,
        userIds: operatorDingTalkIds,
        durationMs: Date.now() - t0,
      });
    } catch (err: unknown) {
      logger.error('Notifier', '钉钉通知发送失败', {
        alarmId: alarm.alarmId,
        error: (err as Error).message,
        durationMs: Date.now() - t0,
      });
    }
  }

  // P3 → 仅日志
  if (alarm.priority === 'P3') {
    logger.info('Notifier', 'P3 告警，仅记录日志', {
      alarmId: alarm.alarmId,
      subject,
    });
  }
}
