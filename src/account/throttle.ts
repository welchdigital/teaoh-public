import type { AccountConfig } from '../config.ts';
import { isLoopback } from '../net/connection-log.ts';
import { SlidingWindowLimiter } from './email.ts';

export interface CreateHistory {
  accountsCreated: number;
  lastAccountCreateAt: number | null;
}

export class AuthThrottle {
  private readonly config: () => AccountConfig;
  private readonly creates: SlidingWindowLimiter;
  private readonly failures: SlidingWindowLimiter;
  private readonly lastCreateByIp = new Map<string, number>();

  constructor(config: () => AccountConfig) {
    this.config = config;
    this.creates = new SlidingWindowLimiter(() => this.config().accountCreateWindow * 1000);
    this.failures = new SlidingWindowLimiter(() => this.config().loginFailureWindow * 1000);
  }

  tryCreate(ip: string, history: CreateHistory, now = Date.now()): string | null {
    const account = this.config();
    const delayMs = account.delayTime * 1000;
    if (account.maxAccountsPerConnection > 0 && history.accountsCreated >= account.maxAccountsPerConnection) {
      return 'too many accounts created on this connection';
    }
    if (history.lastAccountCreateAt !== null && now - history.lastAccountCreateAt < delayMs) {
      return 'account created too recently on this connection';
    }
    if (!isLoopback(ip)) {
      const last = this.lastCreateByIp.get(ip);
      if (last !== undefined && now - last < delayMs) return 'account created too recently from this address';
      if (account.maxAccountsPerIp > 0 && this.creates.count(ip, now) >= account.maxAccountsPerIp) {
        return 'too many accounts created from this address';
      }
      this.lastCreateByIp.set(ip, now);
      this.creates.record(ip, now);
    }
    history.accountsCreated++;
    history.lastAccountCreateAt = now;
    return null;
  }

  loginBlocked(ip: string, accountName: string | null, now = Date.now()): boolean {
    const account = this.config();
    if (
      account.maxLoginFailuresPerIp > 0 &&
      !isLoopback(ip) &&
      this.failures.count(`ip:${ip}`, now) >= account.maxLoginFailuresPerIp
    ) {
      return true;
    }
    return (
      accountName !== null &&
      account.maxLoginFailuresPerAccount > 0 &&
      this.failures.count(`account:${accountName}`, now) >= account.maxLoginFailuresPerAccount
    );
  }

  recordLoginFailure(ip: string, accountName: string | null, now = Date.now()): void {
    if (!isLoopback(ip)) this.failures.record(`ip:${ip}`, now);
    if (accountName !== null) this.failures.record(`account:${accountName}`, now);
  }

  prune(now = Date.now()): void {
    this.creates.prune(now);
    this.failures.prune(now);
    const delayMs = this.config().delayTime * 1000;
    for (const [ip, at] of this.lastCreateByIp) {
      if (now - at >= delayMs) this.lastCreateByIp.delete(ip);
    }
  }
}
