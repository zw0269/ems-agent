import axios from 'axios';

/**
 * 钉钉 Webhook 通知器
 *
 * 使用钉钉群机器人 Webhook 推送 Markdown 消息。
 * 配置方式：在钉钉群中添加「自定义机器人」，复制 Webhook URL 到 DINGTALK_WEBHOOK_URL。
 * 若需 @ 多人，将 userIds 填入 atUserIds（钉钉用户 ID，非手机号）。
 *
 * 环境变量：
 *   DINGTALK_WEBHOOK_URL = https://oapi.dingtalk.com/robot/send?access_token=xxx
 */
export class DingTalkNotifier {
  private webhookUrl: string;

  constructor() {
    this.webhookUrl = process.env['DINGTALK_WEBHOOK_URL'] ?? '';
  }

  /**
   * 发送 Markdown 消息到钉钉群机器人 Webhook
   */
  async send({ userIds, title, content }: {
    userIds: string[];
    title: string;
    content: string;
  }) {
    if (!this.webhookUrl) {
      console.warn('[DingTalk] DINGTALK_WEBHOOK_URL 未配置，跳过发送');
      return;
    }

    try {
      console.log(`[DingTalk] 正在发送消息: ${title}`);

      const payload = {
        msgtype: 'markdown',
        markdown: {
          title,
          text: `### ${title}\n\n${content}`,
        },
        at: {
          atUserIds: userIds,
          isAtAll: false,
        },
      };

      const response = await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });

      if (response.data?.errcode !== 0) {
        console.error('[DingTalk] 钉钉返回错误:', response.data);
      } else {
        console.log('[DingTalk] 钉钉消息发送成功');
      }
    } catch (error: unknown) {
      console.error('[DingTalk] 钉钉消息发送失败:', (error as Error).message);
      // 不抛出错误，以免影响告警处理主流程
    }
  }
}
