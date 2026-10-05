import { DoorOpenClientPacket, EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { openDoor } from '../../world/map/character/door.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function doorOpen(player: Player, reader: EoReader): void {
  const packet = DoorOpenClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.character === null || player.map === null) {
    return;
  }
  openDoor(player.map, player.character, packet.coords.x, packet.coords.y);
}

export function handleDoor(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Open:
      doorOpen(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Door action');
  }
}
