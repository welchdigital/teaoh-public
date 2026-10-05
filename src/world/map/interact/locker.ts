import {
  CHAR_MAX,
  Coords,
  Item,
  ItemSpecial,
  LockerGetServerPacket,
  LockerOpenServerPacket,
  LockerReplyServerPacket,
  LockerSpecServerPacket,
  MapTileSpec,
  THREE_MAX,
  ThreeItem,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { GOLD_ITEM } from '../../../constants.ts';
import type { Player } from '../../../player/player.ts';
import { distance } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';
import { itemSpecial } from '../items.ts';
import { tileSpec } from '../tiles.ts';

function isLockerAccess(map: GameMap, character: Character, x: number, y: number): boolean {
  if (tileSpec(map, x, y) !== MapTileSpec.BankVault) return false;
  return distance(character.row.x, character.row.y, x, y) <= 1;
}

function lockerItems(character: Character): ThreeItem[] {
  return character.bankItems.map((item) => {
    const entry = new ThreeItem();
    entry.id = item.id;
    entry.amount = Math.min(item.amount, THREE_MAX - 1);
    return entry;
  });
}

export function lockerSize(map: GameMap, character: Character): number {
  const { baseSize, sizeStep } = map.deps.config.bank;
  return baseSize + character.row.bank_level * sizeStep;
}

export function openLocker(map: GameMap, player: Player, character: Character, x: number, y: number): void {
  if (!isLockerAccess(map, character, x, y)) return;
  const reply = new LockerOpenServerPacket();
  const coords = new Coords();
  coords.x = x;
  coords.y = y;
  reply.lockerCoords = coords;
  reply.lockerItems = lockerItems(character);
  player.bus.send(reply);
}

export function addToLocker(
  map: GameMap,
  player: Player,
  character: Character,
  x: number,
  y: number,
  itemId: number,
  amount: number,
): void {
  const { config } = map.deps;
  if (itemId <= GOLD_ITEM || amount <= 0 || amount > config.limits.maxItem) return;
  if (!isLockerAccess(map, character, x, y)) return;
  const special = itemSpecial(map, itemId);
  if (special === ItemSpecial.Lore || special === ItemSpecial.Cursed) return;

  const existing = character.bankItems.find((i) => i.id === itemId);
  const size = lockerSize(map, character);
  if (existing === undefined && character.bankItems.length >= size) {
    const full = new LockerSpecServerPacket();
    full.lockerMaxItems = Math.min(size, CHAR_MAX - 1);
    player.bus.send(full);
    return;
  }

  const wanted = character.canBankHold(
    itemId,
    Math.min(amount, character.heldAmount(itemId)),
    config.bank.maxItemAmount,
  );
  if (wanted <= 0) return;
  const deposited = character.removeItem(itemId, wanted);
  if (deposited <= 0) return;
  if (existing !== undefined) {
    existing.amount += deposited;
  } else {
    const item = new Item();
    item.id = itemId;
    item.amount = deposited;
    character.bankItems.push(item);
  }

  const reply = new LockerReplyServerPacket();
  const depositedItem = new Item();
  depositedItem.id = itemId;
  depositedItem.amount = character.heldAmount(itemId);
  reply.depositedItem = depositedItem;
  reply.weight = character.weight(map.deps.pubData);
  reply.lockerItems = lockerItems(character);
  player.bus.send(reply);
}

export function takeFromLocker(
  map: GameMap,
  player: Player,
  character: Character,
  x: number,
  y: number,
  itemId: number,
): void {
  if (!isLockerAccess(map, character, x, y)) return;
  const stored = character.bankItems.find((i) => i.id === itemId);
  if (stored === undefined) return;

  const amount = Math.min(
    character.canHold(map.deps.pubData, itemId, stored.amount, map.deps.config.limits.maxItem),
    THREE_MAX - 1,
  );
  if (amount <= 0) return;
  stored.amount -= amount;
  if (stored.amount <= 0) character.bankItems = character.bankItems.filter((i) => i !== stored);
  character.addItem(itemId, amount);

  const reply = new LockerGetServerPacket();
  const taken = new ThreeItem();
  taken.id = itemId;
  taken.amount = amount;
  reply.takenItem = taken;
  reply.weight = character.weight(map.deps.pubData);
  reply.lockerItems = lockerItems(character);
  player.bus.send(reply);
}
