import { RingBuffer } from './ring-buffer.ts';

export interface LogEvent {
  seq: number;
  ts: number;
  level: number;
  category: string;
  msg: string;
  data: Record<string, unknown>;
}

export interface LogQuery {
  categories?: string[];
  minLevel?: number;
  search?: string;
  afterSeq?: number;
  limit?: number;
}

export const LOG_CAPACITY = 20_000;
const IGNORED_MESSAGES = new Set(['recv', 'wire']);
const RESERVED_KEYS = new Set(['seq', 'time', 'level', 'cat', 'msg']);

function levelCategory(level: number): string {
  if (level <= 20) return 'debug';
  if (level >= 40) return 'error';
  return 'server';
}

function errorFields(err: Error): Record<string, unknown> {
  return { err: err.stack ?? err.message };
}

export class EventLog {
  private readonly buffer: RingBuffer<LogEvent>;
  private readonly counts = new Map<string, number>();

  constructor(capacity = LOG_CAPACITY) {
    this.buffer = new RingBuffer<LogEvent>(capacity);
  }

  record(category: string, msg: string, data: Record<string, unknown> = {}, level = 30): LogEvent {
    return this.push(category, msg, { ...data }, level, Date.now());
  }

  ingest(level: number, args: readonly unknown[]): void {
    let fields: Record<string, unknown> | null = null;
    let message: unknown = undefined;
    const first = args[0];
    if (first instanceof Error) {
      fields = errorFields(first);
      message = args[1] ?? first.message;
    } else if (typeof first === 'object' && first !== null) {
      fields = first as Record<string, unknown>;
      message = args[1];
    } else {
      message = first;
    }
    const msg = typeof message === 'string' ? message : message === undefined ? '' : String(message);
    if (IGNORED_MESSAGES.has(msg)) return;

    let category: string | null = null;
    const data: Record<string, unknown> = {};
    if (fields !== null) {
      for (const key of Object.keys(fields)) {
        const value = fields[key];
        if (key === 'cat') {
          if (typeof value === 'string') category = value;
          continue;
        }
        data[key] = value instanceof Error ? (value.stack ?? value.message) : value;
      }
    }
    this.push(category ?? levelCategory(level), msg, data, level, Date.now());
  }

  private push(
    category: string,
    msg: string,
    data: Record<string, unknown>,
    level: number,
    ts: number,
  ): LogEvent {
    const event: LogEvent = { seq: this.buffer.nextSeq(), ts, level, category, msg, data };
    const evicted = this.buffer.push(event);
    this.counts.set(category, (this.counts.get(category) ?? 0) + 1);
    if (evicted !== undefined) {
      const remaining = (this.counts.get(evicted.category) ?? 1) - 1;
      if (remaining <= 0) this.counts.delete(evicted.category);
      else this.counts.set(evicted.category, remaining);
    }
    return event;
  }

  query(opts: LogQuery = {}): LogEvent[] {
    const { categories, minLevel, search, afterSeq, limit = 200 } = opts;
    const categorySet =
      categories !== undefined && categories.length > 0 ? new Set(categories) : null;
    const needle = search !== undefined && search !== '' ? search.toLowerCase() : null;
    return this.buffer.select(
      (event) =>
        (categorySet === null || categorySet.has(event.category)) &&
        (minLevel === undefined || event.level >= minLevel) &&
        (needle === null || matches(event, needle)),
      limit,
      afterSeq,
    );
  }

  categoryCounts(): Record<string, number> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  latestSeq(): number {
    return this.buffer.latestSeq;
  }

  get size(): number {
    return this.buffer.size;
  }
}

function matches(event: LogEvent, needle: string): boolean {
  if (event.msg.toLowerCase().includes(needle)) return true;
  if (event.category.toLowerCase().includes(needle)) return true;
  for (const value of Object.values(event.data)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'object' ? safeJson(value) : String(value);
    if (text.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export function serializeLogEvent(event: LogEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event.data)) {
    if (!RESERVED_KEYS.has(key)) out[key] = value;
  }
  out['seq'] = event.seq;
  out['time'] = new Date(event.ts).toISOString();
  out['level'] = event.level;
  out['cat'] = event.category;
  out['msg'] = event.msg;
  return out;
}

export const eventLog = new EventLog();
