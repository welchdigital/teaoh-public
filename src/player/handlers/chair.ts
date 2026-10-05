import { ChairRequestClientPacket, EoReader, PacketAction, SitAction } from 'eolib';
import { log } from '../../log.ts';
import { sitChair, stand } from '../../world/map/character/sit.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function chairRequest(player: Player, reader: EoReader): void {
  const packet = ChairRequestClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.character === null || player.map === null) {
    return;
  }
  if (player.frozen) return;

  if (packet.sitAction === SitAction.Sit) {
    const data = packet.sitActionData;
    if (data instanceof ChairRequestClientPacket.SitActionDataSit) {
      sitChair(player.map, player, player.character, data.coords.x, data.coords.y);
    }
  } else if (packet.sitAction === SitAction.Stand) {
    stand(player.map, player, player.character);
  }
}

export function handleChair(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      chairRequest(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Chair action');
  }
}
