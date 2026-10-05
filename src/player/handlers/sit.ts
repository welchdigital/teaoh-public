import { EoReader, PacketAction, SitAction, SitRequestClientPacket, SitState } from 'eolib';
import { log } from '../../log.ts';
import { sit, stand } from '../../world/map/character/sit.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function sitRequest(player: Player, reader: EoReader): void {
  const request = SitRequestClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.character === null || player.map === null) {
    return;
  }
  if (request.sitAction === SitAction.Sit) {
    sit(player.map, player, player.character);
  } else if (request.sitAction === SitAction.Stand) {
    if (player.frozen && player.character.row.sitting === SitState.Chair) return;
    stand(player.map, player, player.character);
  }
}

export function handleSit(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      sitRequest(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Sit action');
  }
}
