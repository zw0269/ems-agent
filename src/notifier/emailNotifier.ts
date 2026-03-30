import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';

/**
 * 邮件通知器（QQ 邮箱 SMTP）
 * SMTP_AUTH_TYPE=login 时使用授权码认证（QQ 邮箱要求）
 * 支持 HTML 正文，换行符自动转为 <br>
 */
export class EmailNotifier {
  private transporter: nodemailer.Transporter;

  constructor() {
    const host    = process.env['SMTP_HOST']     ?? 'smtp.qq.com';
    const port    = parseInt(process.env['SMTP_PORT'] ?? '465', 10);
    const secure  = (process.env['SMTP_SECURE']  ?? 'true') !== 'false';
    const user    = process.env['SMTP_USER']     ?? '';
    const pass    = process.env['SMTP_PASSWORD'] ?? '';
    const name    = process.env['SMTP_FROM_NAME'] ?? 'EMS Agent';

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      // QQ 邮箱需要关闭 STARTTLS 协商（使用 SSL 直连 465）
      tls: { rejectUnauthorized: false },
    });

    logger.info('EmailNotifier', '邮件发送器初始化', { host, port, secure, user, fromName: name });
  }

  async send({ to, subject, body }: { to: string[]; subject: string; body: string }) {
    const user     = process.env['SMTP_USER']     ?? '';
    const fromName = process.env['SMTP_FROM_NAME'] ?? 'EMS Agent';

    // 将纯文本换行转为 HTML，保留代码块格式
    const htmlBody = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>')
      .replace(/  /g, '&nbsp;&nbsp;');

    const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;background:#f8fafc;padding:24px;border-radius:8px;">
  <div style="background:#1a1d27;color:#e2e8f0;padding:16px 20px;border-radius:6px 6px 0 0;border-bottom:3px solid #6366f1;">
    <strong style="font-size:16px;">⚡ EMS Agent 告警分析报告</strong>
  </div>
  <div style="background:#fff;padding:20px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 6px 6px;line-height:1.7;color:#374151;font-size:14px;">
    ${htmlBody}
  </div>
  <div style="color:#9ca3af;font-size:12px;margin-top:12px;text-align:right;">
    由 EMS Agent 自动发送 · ${new Date().toLocaleString('zh-CN', { hour12: false })}
  </div>
</div>`;

    const t0 = Date.now();
    try {
      await this.transporter.sendMail({
        from:    `"${fromName}" <${user}>`,
        to:      to.join(','),
        subject,
        text:    body,
        html,
      });
      logger.info('EmailNotifier', '邮件发送成功', { to, subject, durationMs: Date.now() - t0 });
    } catch (err: unknown) {
      logger.error('EmailNotifier', '邮件发送失败', {
        error: (err as Error).message,
        to,
        subject,
        durationMs: Date.now() - t0,
      });
      throw err;
    }
  }
}
