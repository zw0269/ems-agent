import nodemailer from 'nodemailer';

/**
 * 邮件通知器
 * 封装 nodemailer transporter，支持多收件人发送
 */
export class EmailNotifier {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  /**
   * 发送邮件
   */
  async send({ to, subject, body }: { to: string[]; subject: string; body: string }) {
    try {
      console.log(`[Email] 正在发送邮件至: ${to.join(',')}, 主题: ${subject}`);
      
      await this.transporter.sendMail({
        from: process.env.SMTP_USER,
        to: to.join(','),
        subject,
        text: body,
      });
      
      console.log('[Email] 邮件发送成功');
    } catch (error) {
      console.error('[Email] 邮件发送失败:', (error as Error).message);
      // 这里不抛出错误，以免影响告警处理流程
    }
  }
}
