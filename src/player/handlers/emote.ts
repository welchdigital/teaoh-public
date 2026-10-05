import { EmotePlayerServerPacket, EmoteReportClientPacket, EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function emoteReport(player: Player, reader: EoReader): void {
  const report = EmoteReportClientPacket.deserialize(reader);
  const character = player.character;
  if (player.state !== ClientState.InGame || player.map === null || character === null) return;
  if (character.row.hidden === 1) return;

  const broadcast = new EmotePlayerServerPacket();
  broadcast.playerId = player.id;
  broadcast.emote = report.emote;
  player.map.broadcastNear(broadcast, character.row.x, character.row.y, player.id);
}

export function handleEmote(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Report:
      emoteReport(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Emote action');
  }
}
