import { randomInt, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { parse as parseToml } from 'smol-toml';
import type { SmtpConfig } from '../config.ts';
import { log } from '../log.ts';

export interface MailMessage {
  to: string;
  toName: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
  close(): void;
}

export class SmtpMailer implements Mailer {
  private readonly config: SmtpConfig;
  private transport: Transporter | null = null;

  constructor(config: SmtpConfig) {
    this.config = config;
  }

  get configured(): boolean {
    return this.config.host !== '' && this.config.fromAddress !== '';
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.configured) throw new Error('smtp is not configured');
    this.transport ??= nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      ...(this.config.username !== ''
        ? { auth: { user: this.config.username, pass: this.config.password } }
        : {}),
    });
    await this.transport.sendMail({
      from: { name: this.config.fromName, address: this.config.fromAddress },
      to: { name: message.toName, address: message.to },
      subject: message.subject,
      text: message.text,
    });
  }

  close(): void {
    this.transport?.close();
    this.transport = null;
  }
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailTemplates {
  validation: EmailTemplate;
  recovery: EmailTemplate;
}

export function defaultEmailTemplates(): EmailTemplates {
  return {
    validation: {
      subject: '{server} Confirmation Code',
      body: [
        'Hi {name},',
        '',
        'Thank you for choosing to play on our game server! Your confirmation code is: {code}.',
        '',
        'Please enter this code to continue with account registration. It expires in {minutes} minutes.',
        '',
        'Best regards,',
        '',
        '{server} Team',
      ].join('\n'),
    },
    recovery: {
      subject: '{server} Account Recovery Code',
      body: [
        'Hi {name},',
        '',
        "We've received a request to recover your account. To proceed, please use the following confirmation code: {code}",
        '',
        'Enter this code to initiate the account recovery process and regain access to your account. It expires in {minutes} minutes. If you didn\'t request this, you can ignore this email.',
        '',
        'Best regards,',
        '',
        '{server} Team',
      ].join('\n'),
    },
  };
}

export function loadEmailTemplates(dataDir: string): EmailTemplates {
  const templates = defaultEmailTemplates();
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(readFileSync(join(dataDir, 'emails.toml'), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ cat: 'config', err: String(err) }, 'emails.toml not loaded');
    }
    return templates;
  }
  for (const kind of ['validation', 'recovery'] as const) {
    const section = parsed[kind];
    if (typeof section !== 'object' || section === null) continue;
    const { subject, body } = section as Record<string, unknown>;
    if (typeof subject === 'string') templates[kind].subject = subject;
    if (typeof body === 'string') templates[kind].body = body;
  }
  return templates;
}

export function generateEmailPin(): string {
  return String(randomInt(1_000_000, 10_000_000));
}

export function pinMatches(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual.trim(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class SlidingWindowLimiter {
  private readonly windowMs: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(windowMs: number | (() => number)) {
    this.windowMs = typeof windowMs === 'number' ? () => windowMs : windowMs;
  }

  tryConsume(key: string, max: number, now = Date.now()): boolean {
    if (max <= 0) return true;
    const recent = this.recent(key, now);
    if (recent.length >= max) return false;
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  count(key: string, now = Date.now()): number {
    return this.recent(key, now).length;
  }

  record(key: string, now = Date.now()): void {
    const recent = this.recent(key, now);
    recent.push(now);
    this.hits.set(key, recent);
  }

  prune(now = Date.now()): void {
    const cutoff = now - this.windowMs();
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.windowMs();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length > 0 || this.hits.has(key)) this.hits.set(key, recent);
    return recent;
  }
}

export type EmailPinPurpose = 'validation' | 'recovery';

export interface EmailPin {
  purpose: EmailPinPurpose;
  pin: string;
  accountId: number;
  accountName: string;
  email: string;
  expiresAt: number;
  attempts: number;
  verified: boolean;
}
