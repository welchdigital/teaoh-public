import { RingBuffer } from './ring-buffer.ts';

export const CHAT_CHANNELS = ['local', 'global', 'party', 'guild', 'pm', 'admin', 'announce', 'server'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export interface ChatEvent {
  seq: number;
  ts: number;
  channel: ChatChannel;
  from: string;
  to: string | null;
  map: number | null;
  message: string;
}

export interface ChatInput {
  channel: ChatChannel;
  from: string;
  to?: string | null;
  map?: number | null;
  message: string;
}

export interface ChatQuery {
  channel?: string;
  afterSeq?: number;
  limit?: number;
}

export const CHAT_CAPACITY = 5_000;

export class ChatLog {
  private readonly buffer: RingBuffer<ChatEvent>;

  constructor(capacity = CHAT_CAPACITY) {
    this.buffer = new RingBuffer<ChatEvent>(capacity);
  }

  record(input: ChatInput): ChatEvent {
    const event: ChatEvent = {
      seq: this.buffer.nextSeq(),
      ts: Date.now(),
      channel: input.channel,
      from: input.from,
      to: input.to ?? null,
      map: input.map ?? null,
      message: input.message,
    };
    this.buffer.push(event);
    return event;
  }

  query(opts: ChatQuery = {}): ChatEvent[] {
    const channel = opts.channel !== undefined && opts.channel !== '' ? opts.channel : null;
    return this.buffer.select(
      (event) => channel === null || event.channel === channel,
      opts.limit ?? 200,
      opts.afterSeq,
    );
  }

  latestSeq(): number {
    return this.buffer.latestSeq;
  }

  clear(): void {
    this.buffer.clear();
  }
}

export function serializeChatEvent(event: ChatEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    time: new Date(event.ts).toISOString(),
    channel: event.channel,
    from: event.from,
    to: event.to,
    map: event.map,
    message: event.message,
  };
}

export const chatLog = new ChatLog();
