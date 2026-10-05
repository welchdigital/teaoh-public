import { EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { requestRefresh } from '../../world/map/character/refresh.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function refreshRequest(player: Player): void {
  if (player.state !== ClientState.InGame || player.map === null) return;
  const character = player.character;
  if (character === null) return;
  requestRefresh(player.map, player, character);
}

export function handleRefresh(player: Player, action: number, _reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      refreshRequest(player);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Refresh action');
  }
}
