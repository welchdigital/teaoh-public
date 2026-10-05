import {
  Coords,
  ItemDropServerPacket,
  ItemGetServerPacket,
  ItemJunkServerPacket,
  ItemObtainServerPacket,
  ItemRemoveServerPacket,
  ItemSpecial,
  ThreeItem,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { log } from '../../../log.ts';
import type { Player } from '../../../player/player.ts';
import { distance } from '../../coords.ts';
import { isProtectedItem } from '../../item-rules.ts';
import type { GameMap } from '../game-map.ts';
import { addItem, itemAddPacket, itemSpecial, MAX_GROUND_AMOUNT } from '../items.ts';
import { isWalkable } from '../tiles.ts';

export function giveItem(map: GameMap, player: Player, character: Character, itemId: number, amount: number): void {
  const given = character.canHoldAmount(itemId, amount, map.deps.config.limits.maxItem);
  if (given <= 0) return;
  character.addItem(itemId, given);
  const currentWeight = character.weight(map.deps.pubData).current;
  for (let remaining = given; remaining > 0; remaining -= MAX_GROUND_AMOUNT) {
    const packet = new ItemObtainServerPacket();
    const item = new ThreeItem();
    item.id = itemId;
    item.amount = Math.min(remaining, MAX_GROUND_AMOUNT);
    packet.item = item;
    packet.currentWeight = currentWeight;
    player.bus.send(packet);
  }
  log.info(
    { cat: 'item', event: 'spawn', itemId, amount: given, to: character.name },
    'item spawned',
  );
}

export function getItem(map: GameMap, player: Player, character: Character, itemIndex: number): void {
  const item = map.items.get(itemIndex);
  if (item === undefined) return;
  if (item.protectedTicks > 0 && item.owner !== character.playerId) return;
  if (
    distance(item.x, item.y, character.row.x, character.row.y) >
    map.deps.config.world.dropDistance
  ) {
    return;
  }

  const pickedUp = character.canHold(
    map.deps.pubData,
    item.id,
    Math.min(item.amount, MAX_GROUND_AMOUNT),
    map.deps.config.limits.maxItem,
  );
  if (pickedUp <= 0) return;
  const remainder = item.amount - pickedUp;
  if (remainder > 0) item.amount = remainder;
  else map.items.delete(item.index);

  character.addItem(item.id, pickedUp);

  const reply = new ItemGetServerPacket();
  reply.takenItemIndex = item.index;
  const taken = new ThreeItem();
  taken.id = item.id;
  taken.amount = pickedUp;
  reply.takenItem = taken;
  reply.weight = character.weight(map.deps.pubData);
  player.bus.send(reply);

  const remove = new ItemRemoveServerPacket();
  remove.itemIndex = item.index;
  map.broadcastNear(remove, character.row.x, character.row.y, character.playerId);

  if (remainder > 0) map.broadcastNear(itemAddPacket(item), item.x, item.y);
}

export function dropItem(
  map: GameMap,
  player: Player,
  character: Character,
  itemId: number,
  amount: number,
  x: number,
  y: number,
): void {
  const { config, pubData } = map.deps;
  if (amount <= 0 || amount > config.limits.maxItem || isProtectedItem(config, itemId)) return;
  if (pubData.eif?.parsed.items[itemId - 1] === undefined) return;
  if (itemSpecial(map, itemId) === ItemSpecial.Lore) return;
  if (map.id === config.world.jailMap) return;
  if (distance(x, y, character.row.x, character.row.y) > config.world.dropDistance) return;
  if (!isWalkable(map, x, y)) return;

  const dropped = Math.min(amount, character.heldAmount(itemId), MAX_GROUND_AMOUNT);
  if (dropped <= 0) return;

  const item = addItem(map, itemId, dropped, x, y, character.playerId, config.world.dropProtectPlayer);
  if (item === null) return;
  character.removeItem(itemId, dropped);

  const reply = new ItemDropServerPacket();
  const droppedItem = new ThreeItem();
  droppedItem.id = itemId;
  droppedItem.amount = dropped;
  reply.droppedItem = droppedItem;
  reply.remainingAmount = character.heldAmount(itemId);
  reply.itemIndex = item.index;
  const coords = new Coords();
  coords.x = x;
  coords.y = y;
  reply.coords = coords;
  reply.weight = character.weight(pubData);
  player.bus.send(reply);

  map.broadcastNear(itemAddPacket(item), x, y, character.playerId);
}

export function junkItem(map: GameMap, player: Player, character: Character, itemId: number, amount: number): void {
  if (itemId < 1 || amount <= 0 || amount > map.deps.config.limits.maxItem) return;
  if (isProtectedItem(map.deps.config, itemId)) return;
  const junked = character.removeItem(itemId, Math.min(amount, MAX_GROUND_AMOUNT));
  if (junked === 0) return;

  const reply = new ItemJunkServerPacket();
  const junkedItem = new ThreeItem();
  junkedItem.id = itemId;
  junkedItem.amount = junked;
  reply.junkedItem = junkedItem;
  reply.remainingAmount = character.heldAmount(itemId);
  reply.weight = character.weight(map.deps.pubData);
  player.bus.send(reply);
}
