import { BlockList, isIP } from 'node:net';

export function normalizeIp(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  let ip = value.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) === 0 ? null : ip;
}

export interface Cidr {
  address: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

export function parseCidr(entry: string): Cidr | null {
  const parts = entry.trim().split('/');
  if (parts.length > 2) return null;
  const address = normalizeIp(parts[0]);
  if (address === null) return null;
  const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
  const max = family === 'ipv4' ? 32 : 128;
  const prefixText = parts[1];
  if (prefixText === undefined) return { address, prefix: max, family };
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  return prefix > max ? null : { address, prefix, family };
}

export class AddressMatcher {
  readonly size: number;
  private readonly list = new BlockList();

  constructor(entries: readonly string[]) {
    let size = 0;
    for (const entry of entries) {
      const cidr = parseCidr(entry);
      if (cidr === null) continue;
      this.list.addSubnet(cidr.address, cidr.prefix, cidr.family);
      size++;
    }
    this.size = size;
  }

  matches(ip: string | null | undefined): boolean {
    const normalized = normalizeIp(ip);
    if (normalized === null || this.size === 0) return false;
    return this.list.check(normalized, isIP(normalized) === 4 ? 'ipv4' : 'ipv6');
  }
}

const matchers = new WeakMap<readonly string[], AddressMatcher>();

export function addressMatcher(entries: readonly string[]): AddressMatcher {
  let matcher = matchers.get(entries);
  if (matcher === undefined) {
    matcher = new AddressMatcher(entries);
    matchers.set(entries, matcher);
  }
  return matcher;
}
