import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MapSavesConfig } from '../../config.ts';
import { log } from '../../log.ts';
import type { GameMap } from './game-map.ts';
import { chestKey } from './interact/chest.ts';
import { MAX_GROUND_AMOUNT, MAX_ITEM_INDEX } from './items.ts';
import { spawnNpcs } from './npc/spawn.ts';
import { isInBounds } from './tiles.ts';

export interface SavedItem {
  index: number;
  id: number;
  amount: number;
  x: number;
  y: number;
  owner: number;
  ticks: number;
}

export interface SavedNpcOpponent {
  id: number;
  damage: number;
  ticks: number;
}

export interface SavedNpc {
  index: number;
  x: number;
  y: number;
  direction: number;
  hp: number;
  alive: boolean;
  ticks: number;
  opponents: SavedNpcOpponent[];
}

export interface SavedChestItem {
  x: number;
  y: number;
  slot: number;
  id: number;
  amount: number;
}

export interface SavedChestSpawn {
  x: number;
  y: number;
  slot: number;
  taken: string;
}

export interface MapSaveData {
  rid: number[];
  items: SavedItem[];
  npcs: SavedNpc[];
  chest_items: SavedChestItem[];
  chest_spawns: SavedChestSpawn[];
}

export function mapSavePath(dir: string, mapId: number): string {
  return join(dir, `${String(mapId).padStart(5, '0')}.json`);
}

export function snapshotMapState(map: GameMap): MapSaveData {
  const chests = [...map.chests.values()];
  return {
    rid: [...map.rid],
    items: [...map.items.values()].map((item) => ({
      index: item.index,
      id: item.id,
      amount: item.amount,
      x: item.x,
      y: item.y,
      owner: item.owner,
      ticks: item.protectedTicks,
    })),
    npcs: [...map.npcs.values()]
      .filter((npc) => npc.fromSpawn)
      .map((npc) => ({
        index: npc.index,
        x: npc.x,
        y: npc.y,
        direction: npc.direction,
        hp: npc.hp,
        alive: npc.alive,
        ticks: npc.spawnTicks,
        opponents: npc.opponents.map((opponent) => ({
          id: opponent.playerId,
          damage: opponent.damageDealt,
          ticks: opponent.boredTicks,
        })),
      })),
    chest_items: chests.flatMap((chest) =>
      chest.items.map((item) => ({
        x: chest.x,
        y: chest.y,
        slot: item.slot,
        id: item.id,
        amount: item.amount,
      })),
    ),
    chest_spawns: chests.flatMap((chest) =>
      chest.spawns.map((spawn) => ({
        x: chest.x,
        y: chest.y,
        slot: spawn.slot,
        taken: new Date(spawn.takenAt).toISOString(),
      })),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function restoreNpcs(map: GameMap, saved: Record<string, unknown>[]): void {
  if (!map.npcsInitialized) spawnNpcs(map);
  for (const entry of saved) {
    const index = int(entry['index']);
    const npc = index === null ? undefined : map.npcs.get(index);
    if (npc === undefined || !npc.fromSpawn) continue;
    const x = int(entry['x']);
    const y = int(entry['y']);
    const direction = int(entry['direction']);
    const hp = int(entry['hp']);
    const ticks = int(entry['ticks']);
    const alive = entry['alive'];
    if (x === null || y === null || !isInBounds(map, x, y)) continue;
    if (direction === null || direction < 0 || direction > 3) continue;
    if (hp === null || ticks === null || typeof alive !== 'boolean') continue;
    npc.x = x;
    npc.y = y;
    npc.direction = direction;
    npc.alive = alive;
    npc.hp = alive ? Math.min(Math.max(1, hp), npc.maxHp) : 0;
    npc.spawnTicks = Math.max(0, ticks);
    npc.opponents = [];
  }
}

function restoreItems(map: GameMap, saved: Record<string, unknown>[]): void {
  const itemCount = map.deps.pubData.eif?.parsed.items.length ?? 0;
  const maxAmount = Math.min(map.deps.config.limits.maxItem, MAX_GROUND_AMOUNT);
  const maxItems = map.deps.config.map.maxItems;
  for (const entry of saved) {
    if (maxItems > 0 && map.items.size >= maxItems) break;
    const index = int(entry['index']);
    const id = int(entry['id']);
    const amount = int(entry['amount']);
    const x = int(entry['x']);
    const y = int(entry['y']);
    if (index === null || index < 1 || index > MAX_ITEM_INDEX || map.items.has(index)) continue;
    if (id === null || id < 1 || id > itemCount) continue;
    if (amount === null || amount < 1) continue;
    if (x === null || y === null || !isInBounds(map, x, y)) continue;
    map.items.set(index, { index, id, amount: Math.min(amount, maxAmount), x, y, owner: 0, protectedTicks: 0 });
    map.itemIndexCounter = Math.max(map.itemIndexCounter, index);
  }
}

function restoreChests(
  map: GameMap,
  savedItems: Record<string, unknown>[],
  savedSpawns: Record<string, unknown>[],
): void {
  const itemCount = map.deps.pubData.eif?.parsed.items.length ?? 0;
  const maxChest = map.deps.config.limits.maxChest;
  const maxSlot = map.deps.config.chest.slots;
  for (const chest of map.chests.values()) chest.items = [];

  for (const entry of savedItems) {
    const x = int(entry['x']);
    const y = int(entry['y']);
    const slot = int(entry['slot']);
    const id = int(entry['id']);
    const amount = int(entry['amount']);
    if (x === null || y === null) continue;
    const chest = map.chests.get(chestKey(x, y));
    if (chest === undefined) continue;
    if (slot === null || slot < 0 || slot > maxSlot) continue;
    if (id === null || id < 1 || id > itemCount) continue;
    if (amount === null || amount < 1 || amount > maxChest) continue;
    chest.items.push({ id, amount, slot });
  }

  const seen = new Map<string, number>();
  for (const entry of savedSpawns) {
    const x = int(entry['x']);
    const y = int(entry['y']);
    const slot = int(entry['slot']);
    const taken = typeof entry['taken'] === 'string' ? Date.parse(entry['taken']) : Number.NaN;
    if (x === null || y === null || slot === null || !Number.isFinite(taken)) continue;
    const chest = map.chests.get(chestKey(x, y));
    if (chest === undefined) continue;
    const seenKey = `${x},${y},${slot}`;
    const nth = seen.get(seenKey) ?? 0;
    seen.set(seenKey, nth + 1);
    const spawn = chest.spawns.filter((s) => s.slot === slot)[nth];
    if (spawn !== undefined) spawn.takenAt = Math.min(taken, Date.now());
  }
}

export function loadMapState(map: GameMap, dir: string): boolean {
  const file = mapSavePath(dir, map.id);
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn({ map: map.id, err: String(err) }, 'failed to read map save');
    }
    return false;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    log.warn({ map: map.id, err: String(err) }, 'map save is not valid JSON; ignored');
    return false;
  }
  if (!isRecord(data) || !Array.isArray(data['rid'])) return false;
  const rid = data['rid'];
  if (rid.length !== map.rid.length || rid.some((value, i) => value !== map.rid[i])) {
    log.info({ map: map.id }, 'map file changed since the last save; saved state ignored');
    return false;
  }

  restoreNpcs(map, records(data['npcs']));
  restoreItems(map, records(data['items']));
  restoreChests(map, records(data['chest_items']), records(data['chest_spawns']));
  return true;
}

export function loadMapStates(maps: Iterable<GameMap>, config: MapSavesConfig): number {
  if (!config.enabled || config.dir.trim() === '') return 0;
  let loaded = 0;
  for (const map of maps) {
    try {
      if (loadMapState(map, config.dir)) loaded++;
    } catch (err) {
      log.error({ map: map.id, err: String(err) }, 'failed to load map state');
    }
  }
  if (loaded > 0) log.info({ loaded }, 'map states restored');
  return loaded;
}
