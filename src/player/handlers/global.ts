import {
  EoReader,
  GlobalCloseClientPacket,
  GlobalOpenClientPacket,
  GlobalPlayerClientPacket,
  GlobalRemoveClientPacket,
  PacketAction,
} from 'eolib';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';

const whispersDisabled = new WeakSet<Player>();

export function acceptsWhispers(player: Player): boolean {
  return !whispersDisabled.has(player);
}

export function handleGlobal(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Open:
      GlobalOpenClientPacket.deserialize(reader);
      break;
    case PacketAction.Close:
      GlobalCloseClientPacket.deserialize(reader);
      break;
    case PacketAction.Remove:
      GlobalRemoveClientPacket.deserialize(reader);
      whispersDisabled.delete(player);
      break;
    case PacketAction.Player:
      GlobalPlayerClientPacket.deserialize(reader);
      whispersDisabled.add(player);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Global action');
  }
}
