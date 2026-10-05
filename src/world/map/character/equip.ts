import {
  AvatarAgreeServerPacket,
  AvatarChange,
  AvatarChangeType,
  ItemType,
  PaperdollAgreeServerPacket,
  PaperdollPingServerPacket,
  PaperdollRemoveServerPacket,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { PaperdollSwapServerPacket } from '../../../deep/index.ts';
import type { Player } from '../../../player/player.ts';
import { equippedItem, unequippedItem } from '../../../quest/engine.ts';
import type { GameMap } from '../game-map.ts';

const VISIBLE_TYPES: ReadonlySet<number> = new Set<number>([
  ItemType.Armor,
  ItemType.Weapon,
  ItemType.Shield,
  ItemType.Hat,
  ItemType.Boots,
]);

export function equip(map: GameMap, player: Player, character: Character, itemId: number, subLoc: number): void {
  const { pubData, formulas, config } = map.deps;
  if (character.heldAmount(itemId) === 0) return;
  const result = character.equip(itemId, subLoc, pubData, player.isDeep);
  if (!result.ok) {
    if (result.classRequirement !== null) {
      const ping = new PaperdollPingServerPacket();
      ping.classId = result.classRequirement;
      player.bus.send(ping);
    }
    return;
  }
  character.calculateStats(formulas, pubData, config.combat);

  const change = equipmentChange(map, character);

  if (result.swappedOut !== 0) {
    const swap = new PaperdollSwapServerPacket(change, character.statsEquipmentChange());
    swap.itemId = itemId;
    swap.remainingAmount = character.heldAmount(itemId);
    swap.removedItemId = result.swappedOut;
    swap.removedItemAmount = character.heldAmount(result.swappedOut);
    player.bus.send(swap);
  } else {
    const reply = new PaperdollAgreeServerPacket();
    reply.change = change;
    reply.itemId = itemId;
    reply.remainingAmount = character.heldAmount(itemId);
    reply.subLoc = subLoc;
    reply.stats = character.statsEquipmentChange();
    player.bus.send(reply);
  }

  broadcastAvatarChange(map, character, itemId, change);

  if (result.swappedOut !== 0) unequippedItem(player, result.swappedOut);
  equippedItem(player, itemId);
}

export function unequip(map: GameMap, player: Player, character: Character, itemId: number, subLoc: number): void {
  const { pubData, formulas, config } = map.deps;
  if (!character.unequip(itemId, subLoc, pubData)) return;
  character.calculateStats(formulas, pubData, config.combat);

  const change = equipmentChange(map, character);

  const reply = new PaperdollRemoveServerPacket();
  reply.change = change;
  reply.itemId = itemId;
  reply.subLoc = subLoc;
  reply.stats = character.statsEquipmentChange();
  player.bus.send(reply);

  broadcastAvatarChange(map, character, itemId, change);

  unequippedItem(player, itemId);
}

export function equipmentChange(map: GameMap, character: Character): AvatarChange {
  const change = new AvatarChange();
  change.playerId = character.playerId;
  change.changeType = AvatarChangeType.Equipment;
  change.sound = false;
  const changeData = new AvatarChange.ChangeTypeDataEquipment();
  changeData.equipment = character.equipmentChange(map.deps.pubData);
  change.changeTypeData = changeData;
  return change;
}

export function isVisibleEquipment(map: GameMap, itemId: number): boolean {
  const record = map.deps.pubData.eif?.parsed.items[itemId - 1];
  return record !== undefined && VISIBLE_TYPES.has(record.type);
}

function broadcastAvatarChange(map: GameMap, character: Character, itemId: number, change: AvatarChange): void {
  if (character.row.hidden === 1 || !isVisibleEquipment(map, itemId)) return;
  const packet = new AvatarAgreeServerPacket();
  packet.change = change;
  map.broadcastNear(packet, character.row.x, character.row.y, character.playerId);
}
