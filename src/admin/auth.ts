import { createHash, timingSafeEqual } from 'node:crypto';

export type AuthResult =
  | { ok: true }
  | { ok: false; status: 401 }
  | { ok: false; status: 429; retryAfter: number };

interface FailureRecord {
  count: number;
  first: number;
  lockedUntil: number;
}

const MAX_TRACKED = 10_000;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function keyFingerprint(key: string): string | null {
  return key === '' ? null : createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 8);
}

export function extractKey(headers: Record<string, string | string[] | undefined>): string | undefined {
  const direct = headers['x-admin-key'];
  if (typeof direct === 'string' && direct !== '') return direct;
  const authorization = headers['authorization'];
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match !== null) return match[1];
  }
  return undefined;
}

export class AuthGuard {
  private readonly keyDigest: Buffer | null;
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly failures = new Map<string, FailureRecord>();

  constructor(key: string, maxFailures: number, lockoutSeconds: number) {
    this.keyDigest = key === '' ? null : digest(key);
    this.maxFailures = Math.max(1, maxFailures);
    this.lockoutMs = Math.max(1, lockoutSeconds) * 1000;
  }

  get open(): boolean {
    return this.keyDigest === null;
  }

  check(ip: string, provided: string | undefined, now = Date.now()): AuthResult {
    if (this.keyDigest === null) return { ok: true };
    if (provided === undefined || provided === '') return { ok: false, status: 401 };
    const record = this.failures.get(ip);
    const locked = record !== undefined && record.lockedUntil > now;
    if (timingSafeEqual(digest(provided), this.keyDigest)) {
      if (!locked) this.failures.delete(ip);
      return { ok: true };
    }
    if (locked) {
      return { ok: false, status: 429, retryAfter: Math.max(1, Math.ceil((record.lockedUntil - now) / 1000)) };
    }
    return this.fail(ip, now);
  }

  private fail(ip: string, now: number): AuthResult {
    if (this.failures.size >= MAX_TRACKED) this.prune(now);
    let record = this.failures.get(ip);
    if (record === undefined || now - record.first > this.lockoutMs) {
      record = { count: 0, first: now, lockedUntil: 0 };
      this.failures.set(ip, record);
    }
    record.count++;
    if (record.count >= this.maxFailures) {
      record.lockedUntil = now + this.lockoutMs;
      record.count = 0;
      record.first = now;
      return { ok: false, status: 429, retryAfter: Math.ceil(this.lockoutMs / 1000) };
    }
    return { ok: false, status: 401 };
  }

  prune(now = Date.now()): void {
    for (const [ip, record] of this.failures) {
      if (record.lockedUntil <= now && now - record.first > this.lockoutMs) this.failures.delete(ip);
    }
  }
}
