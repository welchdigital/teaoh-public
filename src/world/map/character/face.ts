import { FacePlayerServerPacket, SitState } from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { GameMap } from '../game-map.ts';

export function face(map: GameMap, character: Character, direction: number): void {
  if (character.row.sitting !== SitState.Stand) return;
  character.direction = direction;
  if (character.row.hidden === 1) return;

  const packet = new FacePlayerServerPacket();
  packet.playerId = character.playerId;
  packet.direction = direction;
  map.broadcastNear(packet, character.row.x, character.row.y, character.playerId);
}
