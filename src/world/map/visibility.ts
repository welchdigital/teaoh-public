import { Coords, ItemMapInfo, NearbyInfo } from 'eolib';
import type { Character } from '../../character/character.ts';
import { inClientRange, inRange } from '../coords.ts';
import type { GameMap, MapItem } from './game-map.ts';
import { groundAmount } from './items.ts';
import type { NpcInstance } from './npc/npc.ts';

export function getNearbyInfo(map: GameMap, x: number, y: number, selfId = 0): NearbyInfo {
  const nearby = new NearbyInfo();
  nearby.characters = [...map.characters.values()]
    .filter((c) => inClientRange(x, y, c.row.x, c.row.y))
    .filter((c) => c.row.hidden !== 1 || c.playerId === selfId)
    .map((c) => c.toMapInfo(map.deps.pubData));
  nearby.npcs = [...map.npcs.values()]
    .filter((n) => n.alive && inClientRange(x, y, n.x, n.y))
    .map((n) => n.toMapInfo());
  nearby.items = [...map.items.values()]
    .filter((i) => inClientRange(x, y, i.x, i.y))
    .map((i) => toItemMapInfo(i));
  return nearby;
}

export function charactersByIds(map: GameMap, observer: Character, playerIds: readonly number[]): Character[] {
  const wanted = new Set(playerIds);
  const found: Character[] = [];
  for (const [playerId, character] of map.characters) {
    if (!wanted.has(playerId)) continue;
    if (character.row.hidden === 1 && playerId !== observer.playerId) continue;
    if (!inRange(observer.row.x, observer.row.y, character.row.x, character.row.y)) continue;
    found.push(character);
  }
  return found;
}

export function npcsByIndexes(map: GameMap, observer: Character, npcIndexes: readonly number[]): NpcInstance[] {
  const wanted = new Set(npcIndexes);
  const found: NpcInstance[] = [];
  for (const [index, npc] of map.npcs) {
    if (!wanted.has(index) || !npc.alive) continue;
    if (!inRange(observer.row.x, observer.row.y, npc.x, npc.y)) continue;
    found.push(npc);
  }
  return found;
}

export function getInfoByIds(
  map: GameMap,
  observer: Character,
  playerIds: readonly number[],
  npcs: readonly NpcInstance[],
): NearbyInfo {
  const nearby = new NearbyInfo();
  nearby.characters = charactersByIds(map, observer, playerIds).map((c) => c.toMapInfo(map.deps.pubData));
  nearby.npcs = npcs.map((n) => n.toMapInfo());
  nearby.items = [];
  return nearby;
}

export function toItemMapInfo(item: MapItem): ItemMapInfo {
  const info = new ItemMapInfo();
  info.uid = item.index;
  info.id = item.id;
  info.amount = groundAmount(item.amount);
  const coords = new Coords();
  coords.x = item.x;
  coords.y = item.y;
  info.coords = coords;
  return info;
}
