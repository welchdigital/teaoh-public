import { EcfRecord, EifRecord, EnfRecord, EoReader, EsfRecord } from 'eolib';
import { log } from '../log.ts';
import { MAX_PAYLOAD } from './socket.ts';

export type PubKind = 'eif' | 'enf' | 'esf' | 'ecf';

export const PUB_HEADER_SIZE = 10;
export const MAX_PUB_CHUNK = MAX_PAYLOAD - 4;

const RECORD_READERS: Record<PubKind, (reader: EoReader) => unknown> = {
  eif: (reader) => EifRecord.deserialize(reader),
  enf: (reader) => EnfRecord.deserialize(reader),
  esf: (reader) => EsfRecord.deserialize(reader),
  ecf: (reader) => EcfRecord.deserialize(reader),
};

const cache = new WeakMap<Uint8Array, Uint8Array[]>();

function split(bytes: Uint8Array, kind: PubKind, maxChunk: number): Uint8Array[] {
  const header = bytes.subarray(0, PUB_HEADER_SIZE);
  const body = bytes.subarray(PUB_HEADER_SIZE);
  const reader = new EoReader(body);
  const read = RECORD_READERS[kind];
  const maxBody = maxChunk - PUB_HEADER_SIZE;
  const ranges: Array<[number, number]> = [];
  let chunkStart = 0;

  while (reader.remaining > 0) {
    const before = reader.position;
    read(reader);
    const after = reader.position;
    if (after <= before) throw new Error('pub record made no progress');
    if (after - before > maxBody) throw new Error('pub record larger than a packet');
    if (after - chunkStart > maxBody) {
      ranges.push([chunkStart, before]);
      chunkStart = before;
    }
  }
  ranges.push([chunkStart, body.length]);

  return ranges.map(([start, end]) => {
    const chunk = new Uint8Array(PUB_HEADER_SIZE + (end - start));
    chunk.set(header, 0);
    chunk.set(body.subarray(start, end), PUB_HEADER_SIZE);
    return chunk;
  });
}

export function splitPubFile(
  bytes: Uint8Array,
  kind: PubKind,
  maxChunk = MAX_PUB_CHUNK,
): Uint8Array[] {
  if (bytes.length <= maxChunk) return [bytes];
  const cached = maxChunk === MAX_PUB_CHUNK ? cache.get(bytes) : undefined;
  if (cached !== undefined) return cached;
  let chunks: Uint8Array[];
  try {
    chunks = split(bytes, kind, maxChunk);
  } catch (err) {
    log.error({ cat: 'server', kind, size: bytes.length, err: String(err) }, 'failed to split pub file');
    chunks = [];
  }
  if (maxChunk === MAX_PUB_CHUNK) cache.set(bytes, chunks);
  return chunks;
}
