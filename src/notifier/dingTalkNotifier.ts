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
   * 钉钉 Markdown text 字段上限约 4000 字节，超出则截断并附加提示
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

    // 钉钉 Webhook markdown text 字段最大约 4000 字节（含标题部分）
    const MAX_CONTENT_BYTES = 3800;
    let safeContent = content;
    if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
      // 按字节截断，避免截断 UTF-8 多字节字符导致乱码
      const buf = Buffer.from(content, 'utf8').slice(0, MAX_CONTENT_BYTES);
      safeContent = buf.toString('utf8').replace(/[^\u0000-\ufffd]*$/, '')
        + '\n\n> ⚠️ 内容过长已截断，完整分析报告请查看邮件或 Web 面板。';
    }

    try {
      console.log(`[DingTalk] 正在发送消息: ${title}`);

      const payload = {
        msgtype: 'markdown',
        markdown: {
          title,
          text: `### ${title}\n\n${safeContent}`,
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
        const errMsg = `钉钉返回错误 errcode=${response.data?.errcode}: ${response.data?.errmsg}`;
        console.error('[DingTalk]', errMsg, response.data);
        throw new Error(errMsg);
      }

      console.log('[DingTalk] 钉钉消息发送成功');
    } catch (error: unknown) {
      console.error('[DingTalk] 钉钉消息发送失败:', (error as Error).message);
      throw error;
    }
  }
}
