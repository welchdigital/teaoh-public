import { EoReader, MessagePingClientPacket, MessagePongServerPacket, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';

export function handleMessage(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Ping:
      MessagePingClientPacket.deserialize(reader);
      player.bus.send(new MessagePongServerPacket());
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Message action');
  }
}
