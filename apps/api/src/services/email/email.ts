import type { Logger } from "pino";

/**
 * Outbound email with a tiered config (DX decision #65): with RESEND_API_KEY
 * set, messages go through Resend's REST API; without it, they are written to
 * the log with the link intact so local development and tests work with zero
 * vendor keys. Tests inject a capturing sink.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSink {
  send(message: EmailMessage): Promise<void>;
}

export class ConsoleEmailSink implements EmailSink {
  constructor(private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<void> {
    this.logger.warn({ to: message.to, subject: message.subject, text: message.text }, "email (no RESEND_API_KEY set; printed instead of sent)");
  }
}

export class CapturingEmailSink implements EmailSink {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export class ResendEmailSink implements EmailSink {
  constructor(private readonly apiKey: string, private readonly from: string, private readonly logger: Logger) {}
  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, ...(message.html ? { html: message.html } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      this.logger.error({ status: res.status, body: body.slice(0, 300), to: message.to, subject: message.subject }, "email delivery failed");
      throw new EmailDeliveryError(`Email provider returned ${res.status}`);
    }
  }
}

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

export function createEmailSink(config: { RESEND_API_KEY?: string; EMAIL_FROM: string }, logger: Logger): EmailSink {
  if (config.RESEND_API_KEY) return new ResendEmailSink(config.RESEND_API_KEY, config.EMAIL_FROM, logger);
  logger.warn("RESEND_API_KEY not set: emails will be printed to this log instead of sent");
  return new ConsoleEmailSink(logger);
}

// Templates: plain, short, one link. Tone T3.
export const templates = {
  verifyEmail(link: string): Omit<EmailMessage, "to"> {
    return {
      subject: "Confirm your email for LedgerIQ",
      text: `Confirm your email to finish setting up LedgerIQ:\n\n${link}\n\nThe link works for 24 hours. If you didn't create an account, ignore this.`,
    };
  },
  resetPassword(link: string): Omit<EmailMessage, "to"> {
    return {
      subject: "Reset your LedgerIQ password",
      text: `Someone asked to reset the password for this LedgerIQ account. If that was you, use this link within the hour:\n\n${link}\n\nIf it wasn't you, ignore this; nothing changes.`,
    };
  },
};
