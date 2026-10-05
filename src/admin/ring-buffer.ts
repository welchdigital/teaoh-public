export interface Sequenced {
  seq: number;
}

export class RingBuffer<T extends Sequenced> {
  private readonly slots: Array<T | undefined>;
  private head = 0;
  private count = 0;
  private lastSeq = 0;

  constructor(capacity: number) {
    this.slots = new Array<T | undefined>(Math.max(1, Math.floor(capacity)));
  }

  get size(): number {
    return this.count;
  }

  get latestSeq(): number {
    return this.lastSeq;
  }

  nextSeq(): number {
    return this.lastSeq + 1;
  }

  push(entry: T): T | undefined {
    const capacity = this.slots.length;
    const index = (this.head + this.count) % capacity;
    let evicted: T | undefined;
    if (this.count === capacity) {
      evicted = this.slots[this.head];
      this.slots[this.head] = entry;
      this.head = (this.head + 1) % capacity;
    } else {
      this.slots[index] = entry;
      this.count++;
    }
    this.lastSeq = entry.seq;
    return evicted;
  }

  at(offset: number): T | undefined {
    if (offset < 0 || offset >= this.count) return undefined;
    return this.slots[(this.head + offset) % this.slots.length];
  }

  get oldestSeq(): number {
    return this.at(0)?.seq ?? this.lastSeq + 1;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  select(filter: (entry: T) => boolean, limit: number, afterSeq?: number): T[] {
    const max = Math.max(0, Math.floor(limit));
    if (max === 0 || this.count === 0) return [];
    if (afterSeq !== undefined) {
      const out: T[] = [];
      const start = Math.max(0, Math.floor(afterSeq) + 1 - this.oldestSeq);
      for (let offset = start; offset < this.count && out.length < max; offset++) {
        const entry = this.at(offset)!;
        if (entry.seq > afterSeq && filter(entry)) out.push(entry);
      }
      return out;
    }
    const newest: T[] = [];
    for (let offset = this.count - 1; offset >= 0 && newest.length < max; offset--) {
      const entry = this.at(offset)!;
      if (filter(entry)) newest.push(entry);
    }
    return newest.reverse();
  }

  *values(): IterableIterator<T> {
    for (let offset = 0; offset < this.count; offset++) yield this.at(offset)!;
  }
}
