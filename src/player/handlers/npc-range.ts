import { EoReader, NpcAgreeServerPacket, NpcRangeRequestClientPacket, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { sendBossPings } from '../../world/map/character/refresh.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function npcRangeRequest(player: Player, reader: EoReader): void {
  const request = NpcRangeRequestClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.map === null || player.character === null) {
    return;
  }

  const requested = new Set(request.npcIndexes);
  const npcs = [...player.map.npcs.values()].filter((npc) => npc.alive && requested.has(npc.index));
  const reply = new NpcAgreeServerPacket();
  reply.npcs = npcs.map((npc) => npc.toMapInfo());
  player.bus.send(reply);
  sendBossPings(player, npcs);
}

export function handleNpcRange(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      npcRangeRequest(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled NpcRange action');
  }
}
