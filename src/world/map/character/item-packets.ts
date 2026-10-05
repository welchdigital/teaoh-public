import type { EoReader, EoWriter } from 'eolib';
import type { OutgoingPacket } from '../../../net/packet-bus.ts';

export const AVATAR_CHANGE_TYPE_SKIN = 4;

export class ItemReportClientPacket {
  itemId = 0;
  title = '';

  static deserialize(reader: EoReader): ItemReportClientPacket {
    const packet = new ItemReportClientPacket();
    const previous = reader.chunkedReadingMode;
    reader.chunkedReadingMode = true;
    try {
      packet.itemId = reader.getShort();
      reader.nextChunk();
      packet.title = reader.getString();
    } finally {
      reader.chunkedReadingMode = previous;
    }
    return packet;
  }
}

export class TrailingCharPacket implements OutgoingPacket {
  readonly inner: OutgoingPacket;
  readonly value: number;

  constructor(inner: OutgoingPacket, value: number) {
    this.inner = inner;
    this.value = value;
  }

  get family(): number {
    return this.inner.family;
  }

  get action(): number {
    return this.inner.action;
  }

  serialize(writer: EoWriter): void {
    this.inner.serialize(writer);
    writer.addChar(this.value);
  }
}
