import { TalkPlayerServerPacket } from 'eolib';
import type { GameMap } from '../game-map.ts';

export function talk(map: GameMap, playerId: number, message: string): void {
  const character = map.characters.get(playerId);
  if (character === undefined || character.row.hidden === 1) return;
  const packet = new TalkPlayerServerPacket();
  packet.playerId = playerId;
  packet.message = message;
  map.broadcastNear(packet, character.row.x, character.row.y, playerId);
}
