import { RefreshReplyServerPacket } from 'eolib';
import type { Character } from '../../../character/character.ts';
import { BossPingServerPacket } from '../../../deep/index.ts';
import type { Player } from '../../../player/player.ts';
import { inClientRange } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';
import type { NpcInstance } from '../npc/npc.ts';
import { getNearbyInfo } from '../visibility.ts';

export function sendBossPings(player: Player, npcs: Iterable<NpcInstance>): void {
  if (!player.isDeep) return;
  for (const npc of npcs) {
    if (!npc.alive || !npc.isBoss) continue;
    const ping = new BossPingServerPacket();
    ping.npcIndex = npc.index;
    ping.npcId = npc.id;
    ping.hp = npc.hp;
    ping.hpPercentage = npc.hpPercentage();
    ping.killed = false;
    player.bus.send(ping);
  }
}

export function requestRefresh(map: GameMap, player: Player, character: Character): void {
  const reply = new RefreshReplyServerPacket();
  reply.nearby = getNearbyInfo(map, character.row.x, character.row.y, character.playerId);
  player.bus.send(reply);
  sendBossPings(
    player,
    [...map.npcs.values()].filter((npc) =>
      inClientRange(character.row.x, character.row.y, npc.x, npc.y),
    ),
  );
}
