import {
  EoWriter,
  InitSequenceStart,
  PacketSequencer,
  encodeNumber,
} from 'eolib';
import type { SequenceStart } from 'eolib';

export interface OutgoingPacket {
  readonly family: number;
  readonly action: number;
  serialize(writer: EoWriter): void;
}
import { decryptPacket, encryptPacket } from './crypto.ts';
import { PacketRateLimiter } from './rate-limits.ts';
import { MAX_PAYLOAD, type GameSocket } from './socket.ts';

export class PacketTooLargeError extends Error {
  readonly size: number;

  constructor(action: number, family: number, size: number) {
    super(`packet ${family}/${action} is ${size} bytes (max ${MAX_PAYLOAD})`);
    this.name = 'PacketTooLargeError';
    this.size = size;
  }
}

export class PacketBus {
  readonly socket: GameSocket;
  readonly sequencer: PacketSequencer;
  readonly rateLimiter = new PacketRateLimiter();
  upcomingSequenceStart: SequenceStart | null = null;
  serverEncryptionMultiple = 0;
  clientEncryptionMultiple = 0;
  needPong = false;

  constructor(socket: GameSocket) {
    this.socket = socket;
    this.sequencer = new PacketSequencer(InitSequenceStart.generate());
  }

  send(packet: OutgoingPacket): void {
    const writer = new EoWriter();
    packet.serialize(writer);
    this.sendRaw(packet.action, packet.family, writer.toByteArray());
  }

  sendRaw(action: number, family: number, data: Uint8Array): void {
    const payloadLength = 2 + data.length;
    if (payloadLength > MAX_PAYLOAD) throw new PacketTooLargeError(action, family, payloadLength);
    const lengthBytes = encodeNumber(payloadLength);
    const frame = new Uint8Array(2 + payloadLength);
    frame[0] = lengthBytes[0] ?? 0;
    frame[1] = lengthBytes[1] ?? 0;
    frame[2] = action;
    frame[3] = family;
    frame.set(data, 4);
    encryptPacket(frame.subarray(2), this.serverEncryptionMultiple);
    this.socket.sendFrame(frame);
  }

  decrypt(payload: Uint8Array): Uint8Array {
    decryptPacket(payload, this.clientEncryptionMultiple);
    return payload;
  }
}
