import nodemailer from 'nodemailer';

export type MailMessage = { to: string; subject: string; text: string };

/** Port: sends one plain-text mail. Rejects when the mail could not be handed over. */
export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export type SmtpSettings = {
  host: string;
  port: number;
  /** Absent for a relay that accepts the server by its address, such as Google Workspace's. */
  auth?: { user: string; password: string };
  /** Sender, for example `Potencializador de rol <no-reply@example.com>`. */
  from: string;
  /** Name the server greets with (EHLO): the public host, never a container id. */
  clientName: string;
};

/**
 * Port 465 uses TLS from the start; other ports must upgrade with STARTTLS. Two Google Workspace
 * setups work: the SMTP relay (`smtp-relay.gmail.com`, port 587, no credentials, the server's
 * address allowed in the Admin console), or one account (`smtp.gmail.com`, port 465, its address
 * and an app password).
 */
export function smtpTransportOptions(settings: SmtpSettings) {
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    name: settings.clientName,
    ...(settings.auth ? { auth: { user: settings.auth.user, pass: settings.auth.password } } : {}),
  };
}

/** SMTP adapter. */
export function createSmtpMailer(settings: SmtpSettings): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(settings));
  return {
    async send(message) {
      await transport.sendMail({ from: settings.from, ...message });
    },
  };
}
