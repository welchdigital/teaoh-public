import { Coords, ItemAddServerPacket, ItemRemoveServerPacket, ItemSpecial, THREE_MAX } from 'eolib';
import { log } from '../../log.ts';
import type { GameMap, MapItem } from './game-map.ts';

export const MAX_ITEM_INDEX = 64000;
export const MAX_GROUND_AMOUNT = THREE_MAX - 1;

export function groundAmount(amount: number): number {
  return Math.max(0, Math.min(amount, MAX_GROUND_AMOUNT));
}

function nextItemIndex(map: GameMap): number | null {
  for (let attempt = 0; attempt < MAX_ITEM_INDEX; attempt++) {
    map.itemIndexCounter = (map.itemIndexCounter % MAX_ITEM_INDEX) + 1;
    if (!map.items.has(map.itemIndexCounter)) return map.itemIndexCounter;
  }
  return null;
}

export function addItem(
  map: GameMap,
  itemId: number,
  amount: number,
  x: number,
  y: number,
  owner: number,
  protectedTicks: number,
): MapItem | null {
  const stack = groundAmount(amount);
  if (stack <= 0) return null;
  const index = nextItemIndex(map);
  if (index === null) {
    log.warn({ map: map.id, itemId }, 'no free ground item index');
    return null;
  }
  const item: MapItem = { index, id: itemId, amount: stack, x, y, owner, protectedTicks };
  map.items.set(index, item);
  return item;
}

export function itemAddPacket(item: MapItem): ItemAddServerPacket {
  const add = new ItemAddServerPacket();
  add.itemId = item.id;
  add.itemIndex = item.index;
  add.itemAmount = groundAmount(item.amount);
  const coords = new Coords();
  coords.x = item.x;
  coords.y = item.y;
  add.coords = coords;
  return add;
}

export function dropItemOnGround(map: GameMap, itemId: number, amount: number, x: number, y: number): void {
  const item = addItem(map, itemId, amount, x, y, 0, 0);
  if (item === null) return;
  map.broadcastNear(itemAddPacket(item), x, y);
  log.info({ cat: 'item', event: 'drop', itemId, amount: item.amount, map: map.id, x, y }, 'item dropped');
}

export function removeItem(map: GameMap, itemIndex: number): void {
  const item = map.items.get(itemIndex);
  if (item === undefined) return;
  map.items.delete(itemIndex);
  const remove = new ItemRemoveServerPacket();
  remove.itemIndex = itemIndex;
  map.broadcastNear(remove, item.x, item.y);
}

export function timedCleanup(map: GameMap): void {
  const max = map.deps.config.map.maxItems;
  if (max <= 0 || map.items.size <= max) return;
  const excess = map.items.size - max;
  const oldest = [...map.items.keys()].slice(0, excess);
  for (const index of oldest) removeItem(map, index);
}

export function itemSpecial(map: GameMap, itemId: number): number {
  return map.deps.pubData.eif?.parsed.items[itemId - 1]?.special ?? ItemSpecial.Normal;
}
