import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ messageId: string }>;
  close(): void;
}

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

const mascarar = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

/** SÓ TESTES: não envia nada; guarda as últimas mensagens para inspeção. */
export class LogEmailSender implements EmailSender {
  private readonly logger = new Logger('LogEmailSender');
  readonly sent: EmailMessage[] = [];

  send(message: EmailMessage): Promise<{ messageId: string }> {
    this.sent.push(message);
    if (this.sent.length > 200) this.sent.shift();
    this.logger.log({ to: mascarar(message.to), subject: message.subject }, 'E-mail não enviado (EMAIL_PROVIDER=log)');
    return Promise.resolve({ messageId: `log-${this.sent.length}` });
  }

  close(): void {}
}

export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const info = await this.transporter.sendMail({ from: this.from, ...message });
    return { messageId: info.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}
