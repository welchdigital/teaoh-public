interface Entry {
  connections: number;
  lastConnect: number;
}

export function isLoopback(ip: string): boolean {
  return ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
}

export class ConnectionLog {
  private readonly entries = new Map<string, Entry>();

  connections(ip: string): number {
    return this.entries.get(ip)?.connections ?? 0;
  }

  lastConnect(ip: string): number | undefined {
    return this.entries.get(ip)?.lastConnect;
  }

  get total(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.connections;
    return total;
  }

  get size(): number {
    return this.entries.size;
  }

  add(ip: string, now = Date.now()): void {
    const entry = this.entries.get(ip);
    if (entry === undefined) {
      this.entries.set(ip, { connections: 1, lastConnect: now });
    } else {
      entry.connections++;
      entry.lastConnect = now;
    }
  }

  remove(ip: string): void {
    const entry = this.entries.get(ip);
    if (entry !== undefined && entry.connections > 0) entry.connections--;
  }

  prune(now: number, maxAgeMs: number): void {
    for (const [ip, entry] of this.entries) {
      if (entry.connections === 0 && now - entry.lastConnect >= maxAgeMs) this.entries.delete(ip);
    }
  }
}
