import {
  ChestAgreeServerPacket,
  ChestCloseServerPacket,
  ChestGetServerPacket,
  ChestOpenServerPacket,
  ChestReplyServerPacket,
  ChestSpecServerPacket,
  Coords,
  EoWriter,
  ItemSpecial,
  ItemType,
  MapTileSpec,
  THREE_MAX,
  ThreeItem,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { log } from '../../../log.ts';
import type { Player } from '../../../player/player.ts';
import { distance } from '../../coords.ts';
import type { ChestState, GameMap } from '../game-map.ts';
import { randomRange } from '../math.ts';
import { tileSpec } from '../tiles.ts';

export class ChestAgreeUpdate extends ChestAgreeServerPacket {
  override serialize(writer: EoWriter): void {
    if (this.items.length === 0) {
      writer.addByte(0xff);
      return;
    }
    super.serialize(writer);
  }
}

export function chestKey(x: number, y: number): string {
  return `${x},${y}`;
}

function newChest(x: number, y: number): ChestState {
  return { x, y, key: 0, items: [], spawns: [] };
}

function ensureChest(map: GameMap, x: number, y: number): ChestState {
  const key = chestKey(x, y);
  let chest = map.chests.get(key);
  if (chest === undefined) {
    chest = newChest(x, y);
    map.chests.set(key, chest);
  }
  return chest;
}

export function initChests(map: GameMap): void {
  const now = Date.now();
  const spawnOnBoot = map.deps.config.world.chestSpawnOnBoot;
  const maxSlots = map.deps.config.chest.slots;
  for (const spawn of map.emf.items) {
    const { x, y } = spawn.coords;
    if (tileSpec(map, x, y) !== MapTileSpec.Chest) continue;
    const chest = ensureChest(map, x, y);
    if (chest.key === 0 && spawn.key !== 0) chest.key = spawn.key;
    const slot = spawn.chestSlot + 1;
    if (slot > maxSlots) {
      log.warn({ map: map.id, x, y, slot }, 'chest spawn slot exceeds chest.slots; ignored');
      continue;
    }
    if (spawn.itemId <= 0 || spawn.amount <= 0) continue;
    chest.spawns.push({
      itemId: spawn.itemId,
      amount: spawn.amount,
      spawnTime: spawn.spawnTime,
      slot,
      takenAt: spawnOnBoot ? 0 : now,
    });
  }
  for (const row of map.emf.tileSpecRows) {
    for (const tile of row.tiles) {
      if (tile.tileSpec === MapTileSpec.Chest) ensureChest(map, tile.x, row.y);
    }
  }
  if (spawnOnBoot) {
    for (const chest of map.chests.values()) fillChest(map, chest, now);
  }
}

function fillChest(map: GameMap, chest: ChestState, now: number): boolean {
  const maxSlot = chest.spawns.reduce((max, spawn) => Math.max(max, spawn.slot), 0);
  const maxChest = map.deps.config.limits.maxChest;
  let spawned = false;
  for (let slot = 1; slot <= maxSlot; slot++) {
    if (chest.items.some((item) => item.slot === slot)) continue;
    const ready = chest.spawns.filter(
      (spawn) => spawn.slot === slot && now - spawn.takenAt >= spawn.spawnTime * 60_000,
    );
    if (ready.length === 0) continue;
    const pick = ready[randomRange(0, ready.length - 1)]!;
    const amount = Math.min(pick.amount, maxChest);
    const deposit = chest.items.find((item) => item.slot === 0 && item.id === pick.itemId);
    if (deposit !== undefined) {
      deposit.slot = slot;
      deposit.amount = Math.min(deposit.amount + pick.amount, maxChest);
    } else {
      chest.items.push({ id: pick.itemId, amount, slot });
    }
    spawned = true;
    log.debug(
      { cat: 'chest', itemId: pick.itemId, amount, map: map.id, x: chest.x, y: chest.y },
      'chest item spawned',
    );
  }
  return spawned;
}

function chestAt(map: GameMap, character: Character, x: number, y: number): ChestState | undefined {
  if (tileSpec(map, x, y) !== MapTileSpec.Chest) return undefined;
  if (distance(character.row.x, character.row.y, x, y) > 1) return undefined;
  return ensureChest(map, x, y);
}

function openedChest(
  map: GameMap,
  player: Player,
  character: Character,
  x: number,
  y: number,
): ChestState | undefined {
  if (player.openChestKey !== chestKey(x, y)) return undefined;
  return chestAt(map, character, x, y);
}

function chestContents(chest: ChestState): ThreeItem[] {
  return chest.items.map((item) => {
    const entry = new ThreeItem();
    entry.id = item.id;
    entry.amount = Math.min(item.amount, THREE_MAX - 1);
    return entry;
  });
}

function usedSlots(chest: ChestState): number {
  const spawnSlots = new Set(chest.spawns.map((spawn) => spawn.slot)).size;
  return spawnSlots + chest.items.filter((item) => item.slot === 0).length;
}

function hasKey(map: GameMap, character: Character, key: number): boolean {
  const items = map.deps.pubData.eif?.parsed.items;
  return character.items.some((item) => {
    const record = items?.[item.id - 1];
    return record !== undefined && record.type === ItemType.Key && record.spec1 === key;
  });
}

function notifyViewers(map: GameMap, chest: ChestState, exceptPlayerId?: number): void {
  const key = chestKey(chest.x, chest.y);
  let packet: ChestAgreeUpdate | null = null;
  for (const [playerId, player] of map.players) {
    if (playerId === exceptPlayerId || player.openChestKey !== key) continue;
    const character = map.characters.get(playerId);
    if (character === undefined || distance(character.row.x, character.row.y, chest.x, chest.y) > 1) {
      continue;
    }
    if (packet === null) {
      packet = new ChestAgreeUpdate();
      packet.items = chestContents(chest);
    }
    player.bus.send(packet);
  }
}

export function openChest(map: GameMap, player: Player, character: Character, x: number, y: number): void {
  const chest = chestAt(map, character, x, y);
  if (chest === undefined) return;
  if (chest.key !== 0 && !hasKey(map, character, chest.key)) {
    const locked = new ChestCloseServerPacket();
    locked.key = chest.key;
    player.bus.send(locked);
    return;
  }
  player.openChestKey = chestKey(x, y);
  const reply = new ChestOpenServerPacket();
  const coords = new Coords();
  coords.x = x;
  coords.y = y;
  reply.coords = coords;
  reply.items = chestContents(chest);
  player.bus.send(reply);
}

export function addToChest(
  map: GameMap,
  player: Player,
  character: Character,
  x: number,
  y: number,
  itemId: number,
  amount: number,
): void {
  const chest = openedChest(map, player, character, x, y);
  if (chest === undefined || itemId <= 0 || amount <= 0) return;
  const record = map.deps.pubData.eif?.parsed.items[itemId - 1];
  if (record === undefined || record.special === ItemSpecial.Lore) return;

  const existing = chest.items.find((item) => item.id === itemId);
  if (existing === undefined && usedSlots(chest) >= map.deps.config.chest.slots) {
    player.bus.send(new ChestSpecServerPacket());
    return;
  }
  const room = map.deps.config.limits.maxChest - (existing?.amount ?? 0);
  const wanted = Math.min(amount, character.heldAmount(itemId), room);
  if (wanted <= 0) {
    if (room <= 0) player.bus.send(new ChestSpecServerPacket());
    return;
  }
  const added = character.removeItem(itemId, wanted);
  if (added <= 0) return;
  if (existing !== undefined) {
    existing.amount += added;
  } else {
    chest.items.push({ id: itemId, amount: added, slot: 0 });
  }

  const reply = new ChestReplyServerPacket();
  reply.addedItemId = itemId;
  reply.remainingAmount = character.heldAmount(itemId);
  reply.weight = character.weight(map.deps.pubData);
  reply.items = chestContents(chest);
  player.bus.send(reply);
  notifyViewers(map, chest, player.id);
}

export function takeFromChest(
  map: GameMap,
  player: Player,
  character: Character,
  x: number,
  y: number,
  itemId: number,
): void {
  const chest = openedChest(map, player, character, x, y);
  if (chest === undefined) return;
  const index = chest.items.findIndex((item) => item.id === itemId);
  const stored = chest.items[index];
  if (stored === undefined) return;
  const taken = Math.min(
    character.canHold(map.deps.pubData, itemId, stored.amount, map.deps.config.limits.maxItem),
    THREE_MAX - 1,
  );
  if (taken <= 0) return;

  stored.amount -= taken;
  if (stored.amount <= 0) {
    chest.items.splice(index, 1);
    if (stored.slot > 0) {
      const now = Date.now();
      const spawnTime =
        chest.spawns.find((spawn) => spawn.slot === stored.slot && spawn.itemId === itemId)
          ?.spawnTime ?? 0;
      for (const spawn of chest.spawns) {
        if (spawn.slot === stored.slot && spawn.spawnTime === spawnTime) spawn.takenAt = now;
      }
    }
  }
  character.addItem(itemId, taken);

  const reply = new ChestGetServerPacket();
  const takenItem = new ThreeItem();
  takenItem.id = itemId;
  takenItem.amount = taken;
  reply.takenItem = takenItem;
  reply.weight = character.weight(map.deps.pubData);
  reply.items = chestContents(chest);
  player.bus.send(reply);
  notifyViewers(map, chest, player.id);
}

export function spawnChestItems(map: GameMap): void {
  const now = Date.now();
  for (const chest of map.chests.values()) {
    if (chest.spawns.length > 0 && fillChest(map, chest, now)) notifyViewers(map, chest);
  }
}
