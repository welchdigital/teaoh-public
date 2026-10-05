import { PacketAction, PacketFamily } from 'eolib';
import type { EoReader, EoWriter } from 'eolib';

export const LookupType = {
  Item: 1,
  Npc: 2,
} as const;

export type LookupType = (typeof LookupType)[keyof typeof LookupType];

export interface DialogLine {
  left: string;
  right: string;
}

function writeLines(writer: EoWriter, lines: readonly DialogLine[]): void {
  for (const line of lines) {
    writer.addString(line.left);
    writer.addByte(0xff);
    writer.addString(line.right);
    writer.addByte(0xff);
  }
}

export class AdminInteractTakeClientPacket {
  lookupType = 0;
  id = 0;

  static deserialize(reader: EoReader): AdminInteractTakeClientPacket {
    const packet = new AdminInteractTakeClientPacket();
    packet.lookupType = reader.getChar();
    packet.id = reader.getShort();
    return packet;
  }

  serialize(writer: EoWriter): void {
    writer.addChar(this.lookupType);
    writer.addShort(this.id);
  }
}

export class AdminInteractAddServerPacket {
  lines: DialogLine[] = [];

  readonly family = PacketFamily.AdminInteract;
  readonly action = PacketAction.Add;

  serialize(writer: EoWriter): void {
    writeLines(writer, this.lines);
  }
}
