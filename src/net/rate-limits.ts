import { PacketAction, PacketFamily } from 'eolib';
import {
  ANY_ACTION,
  MAX_PACKET_RATE_BURST,
  MAX_PACKET_RATE_LIMIT,
  type PacketRateLimit,
} from '../config.ts';

export interface RateLimitRule {
  limit: number;
  burst: number;
}

export type RateLimitTable = ReadonlyMap<number, RateLimitRule>;

const FAMILY_WIDE = 0x10000;
const UNLIMITED_FAMILIES: ReadonlySet<number> = new Set([PacketFamily.Init, PacketFamily.Connection]);

function rateLimitKey(family: number, action: number): number {
  return (family << 8) | action;
}

function familyKey(family: number): number {
  return FAMILY_WIDE | family;
}

function enumValue(names: Record<string, string | number>, name: string): number | undefined {
  const direct = names[name];
  if (typeof direct === 'number') return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(names)) {
    if (typeof value === 'number' && key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function compileRateLimits(limits: readonly PacketRateLimit[]): RateLimitTable {
  const table = new Map<number, RateLimitRule>();
  for (const entry of limits) {
    const family = enumValue(PacketFamily, entry.family);
    if (family === undefined || UNLIMITED_FAMILIES.has(family) || !(entry.limit > 0)) continue;
    const rule = {
      limit: Math.min(MAX_PACKET_RATE_LIMIT, entry.limit),
      burst: Math.min(MAX_PACKET_RATE_BURST, Math.max(1, Math.floor(entry.burst ?? 1))),
    };
    if (entry.action.trim() === ANY_ACTION) {
      table.set(familyKey(family), rule);
      continue;
    }
    const action = enumValue(PacketAction, entry.action);
    if (action === undefined) continue;
    table.set(rateLimitKey(family, action), rule);
  }
  return table;
}

const compiled = new WeakMap<readonly PacketRateLimit[], RateLimitTable>();

export function rateLimitTable(limits: readonly PacketRateLimit[]): RateLimitTable {
  let table = compiled.get(limits);
  if (table === undefined) {
    table = compileRateLimits(limits);
    compiled.set(limits, table);
  }
  return table;
}

interface Bucket {
  tokens: number;
  at: number;
  fullAt: number;
}

export class PacketRateLimiter {
  private readonly buckets = new Map<number, Bucket>();

  shouldDrop(family: number, action: number, table: RateLimitTable, now: number): boolean {
    let key = rateLimitKey(family, action);
    let rule = table.get(key);
    if (rule === undefined) {
      key = familyKey(family);
      rule = table.get(key);
    }
    if (rule === undefined) return false;
    const bucket = this.buckets.get(key);
    const tokens =
      bucket === undefined ? rule.burst : Math.min(rule.burst, bucket.tokens + (now - bucket.at) / rule.limit);
    if (tokens < 1) return true;
    const left = tokens - 1;
    this.buckets.set(key, { tokens: left, at: now, fullAt: now + (rule.burst - left) * rule.limit });
    return false;
  }

  prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.fullAt) this.buckets.delete(key);
    }
  }
}
