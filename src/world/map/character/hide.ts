import {
  AdminInteractAgreeServerPacket,
  AdminInteractRemoveServerPacket,
  NearbyInfo,
  PlayersAgreeServerPacket,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { GameMap } from '../game-map.ts';

export function toggleHidden(map: GameMap, character: Character): boolean {
  character.row.hidden = character.row.hidden === 1 ? 0 : 1;
  if (character.row.hidden === 1) {
    const remove = new AdminInteractRemoveServerPacket();
    remove.playerId = character.playerId;
    map.broadcastNear(remove, character.row.x, character.row.y);
  } else {
    const agree = new PlayersAgreeServerPacket();
    const nearby = new NearbyInfo();
    nearby.characters = [character.toMapInfo(map.deps.pubData)];
    nearby.npcs = [];
    nearby.items = [];
    agree.nearby = nearby;
    map.broadcastNear(agree, character.row.x, character.row.y, character.playerId);
    const reveal = new AdminInteractAgreeServerPacket();
    reveal.playerId = character.playerId;
    map.broadcastNear(reveal, character.row.x, character.row.y);
  }
  return character.row.hidden === 1;
}
