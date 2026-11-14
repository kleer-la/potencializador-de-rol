import nodemailer from 'nodemailer';

export type MailMessage = { to: string; subject: string; text: string };

/** Port: sends one plain-text mail. Rejects when the mail could not be handed over. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type SmtpSettings = {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Sender, for example `Potencializador de rol <no-reply@example.com>`. */
  from: string;
};

/**
 * SMTP adapter. With Google Workspace: host `smtp.gmail.com`, port 465, the account's
 * address as user and an app password. Port 465 uses TLS from the start; other ports
 * must upgrade with STARTTLS.
 */
export function createSmtpMailer(settings: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
  });
  return {
    async send(message) {
      await transport.sendMail({ from: settings.from, ...message });
    },
  };
}
