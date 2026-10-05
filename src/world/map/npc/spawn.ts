import { CHAR_MAX, Direction, NpcAgreeServerPacket, NpcType } from 'eolib';
import type { GameMap } from '../game-map.ts';
import { clamp, randomRange } from '../math.ts';
import { isNpcWalkable, isOccupied } from '../tiles.ts';
import { NpcInstance } from './npc.ts';

export const STATIONARY_SPAWN_TYPE = 7;
const MAX_NPC_INDEX = CHAR_MAX - 1;
const SPAWN_ATTEMPTS = 200;
const TALK_STAGGER = 60;

export function nextNpcIndex(map: GameMap): number | null {
  for (let index = 1; index <= MAX_NPC_INDEX; index++) {
    if (!map.npcs.has(index)) return index;
  }
  return null;
}

function createSpawnNpcs(map: GameMap): void {
  for (const [index, npc] of map.npcs) {
    if (npc.fromSpawn) map.npcs.delete(index);
  }
  for (const spawn of map.emf.npcs) {
    const record = map.deps.pubData.enf?.parsed.npcs[spawn.id - 1];
    if (record === undefined) continue;
    for (let i = 0; i < spawn.amount; i++) {
      const index = nextNpcIndex(map);
      if (index === null) return;
      const npc = new NpcInstance(
        index,
        spawn.id,
        record,
        {
          x: spawn.coords.x,
          y: spawn.coords.y,
          spawnType: spawn.spawnType,
          spawnTime: spawn.spawnTime,
        },
        map.deps.config.npcs.instantSpawn,
      );
      npc.talkTicks = -TALK_STAGGER * i;
      map.npcs.set(index, npc);
    }
  }
}

function spawnPosition(map: GameMap, npc: NpcInstance): { x: number; y: number } {
  const origin = npc.spawnCoords;
  const variable =
    npc.spawnType !== STATIONARY_SPAWN_TYPE &&
    (npc.data.type === NpcType.Passive || npc.data.type === NpcType.Aggressive);
  if (!variable) return { x: origin.x, y: origin.y };
  for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt++) {
    const x = clamp(origin.x + randomRange(-2, 2), 0, map.emf.width);
    const y = clamp(origin.y + randomRange(-2, 2), 0, map.emf.height);
    if (isNpcWalkable(map, x, y) && !isOccupied(map, x, y)) return { x, y };
  }
  return { x: origin.x, y: origin.y };
}

export function spawnNpcs(map: GameMap): void {
  for (const [index, npc] of map.npcs) {
    if (!npc.fromSpawn && !npc.alive) map.npcs.delete(index);
  }

  if (!map.npcsInitialized) {
    map.npcsInitialized = true;
    createSpawnNpcs(map);
  }

  let boss: NpcInstance | undefined;
  for (const npc of map.npcs.values()) {
    if (npc.isBoss) {
      boss = npc;
      break;
    }
  }

  for (const npc of map.npcs.values()) {
    if (npc.alive || !npc.fromSpawn) continue;
    npc.spawnTicks = Math.max(npc.spawnTicks - 1, 0);
    if (npc.isChild && boss !== undefined && !boss.alive) continue;
    if (npc.spawnTicks > 0) continue;

    const position = spawnPosition(map, npc);
    npc.alive = true;
    npc.hp = npc.maxHp;
    npc.opponents = [];
    npc.x = position.x;
    npc.y = position.y;
    npc.direction =
      npc.spawnType === STATIONARY_SPAWN_TYPE
        ? npc.spawnTime & 0x03
        : randomRange(Direction.Down, Direction.Right);
  }
}

export function adminSpawnNpc(map: GameMap, npcId: number, x: number, y: number, spawnType = 1): boolean {
  const record = map.deps.pubData.enf?.parsed.npcs[npcId - 1];
  if (record === undefined) return false;
  const index = nextNpcIndex(map);
  if (index === null) return false;
  const npc = new NpcInstance(
    index,
    npcId,
    record,
    { x, y, spawnType: clamp(spawnType, 0, STATIONARY_SPAWN_TYPE), spawnTime: 0 },
    true,
    false,
  );
  npc.alive = true;
  npc.x = x;
  npc.y = y;
  npc.direction = Direction.Down;
  npc.hp = npc.maxHp;
  map.npcs.set(npc.index, npc);

  const agree = new NpcAgreeServerPacket();
  agree.npcs = [npc.toMapInfo()];
  map.broadcastNear(agree, x, y);
  return true;
}
