import type { WorldConfig } from '../config.ts';
import type { PubData } from '../data/pub-data.ts';
import type { Character } from './character.ts';

export interface SpawnLocation {
  map: number;
  x: number;
  y: number;
}

export function spawnLocation(
  character: Character,
  pubData: PubData,
  world: WorldConfig,
): SpawnLocation {
  const home = character.row.home ?? '';
  const inn = pubData.inns?.inns.find((candidate) => candidate.name === home);
  if (inn === undefined) {
    return { map: world.spawnMap, x: world.spawnX, y: world.spawnY };
  }
  if (inn.alternateSpawnEnabled && character.row.level > 0) {
    return { map: inn.alternateSpawnMap, x: inn.alternateSpawnX, y: inn.alternateSpawnY };
  }
  return { map: inn.spawnMap, x: inn.spawnX, y: inn.spawnY };
}

export function respawnLocation(
  character: Character,
  pubData: PubData,
  world: WorldConfig,
  hasMap: (mapId: number) => boolean,
): SpawnLocation {
  const spawn = spawnLocation(character, pubData, world);
  if (hasMap(spawn.map)) return spawn;
  return { map: world.rescueMap, x: world.rescueX, y: world.rescueY };
}
