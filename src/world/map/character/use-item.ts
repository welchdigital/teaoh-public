import {
  AvatarAgreeServerPacket,
  AvatarChange,
  AvatarChangeType,
  AvatarRemoveServerPacket,
  CHAR_MAX,
  EffectPlayerServerPacket,
  type EifRecord,
  Item,
  ItemAcceptServerPacket,
  ItemAgreeServerPacket,
  ItemReplyServerPacket,
  ItemType,
  NearbyInfo,
  PlayerEffect,
  PlayersAgreeServerPacket,
  RecoverAgreeServerPacket,
  SHORT_MAX,
  Spell,
  WarpEffect,
} from 'eolib';
import type { Character, EquipmentSlot } from '../../../character/character.ts';
import { MAX_TITLE_COLUMN } from '../../../config.ts';
import type { OutgoingPacket } from '../../../net/packet-bus.ts';
import type { Player } from '../../../player/player.ts';
import { inClientRange } from '../../coords.ts';
import { isInfiniteUseItem } from '../../item-rules.ts';
import { hpPercentage } from '../events/hazards.ts';
import type { GameMap } from '../game-map.ts';
import { broadcastPartyHp } from '../party-hp.ts';
import { equipmentChange } from './equip.ts';
import { giveExperience } from './experience.ts';
import { AVATAR_CHANGE_TYPE_SKIN, TrailingCharPacket } from './item-packets.ts';
import { warpPending } from './walk.ts';

interface UseContext {
  map: GameMap;
  player: Player;
  character: Character;
  itemId: number;
  record: EifRecord;
  reply: ItemReplyServerPacket;
  trailingChar: number | null;
}

type UseHandler = (context: UseContext) => boolean;

const VISIBLE_SLOTS: ReadonlySet<EquipmentSlot> = new Set<EquipmentSlot>([
  'boots',
  'armor',
  'hat',
  'shield',
  'weapon',
]);

function isChar(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < CHAR_MAX;
}

function useHeal({ map, character, record, reply }: UseContext): boolean {
  const hpGain = Math.max(0, Math.min(record.hp, character.maxHp - character.row.hp));
  const tpGain = Math.max(0, Math.min(record.tp, character.maxTp - character.row.tp));
  if (hpGain <= 0 && tpGain <= 0) return false;
  character.row.hp += hpGain;
  character.row.tp += tpGain;

  const data = new ItemReplyServerPacket.ItemTypeDataHeal();
  data.hpGain = hpGain;
  data.hp = character.row.hp;
  data.tp = character.row.tp;
  reply.itemTypeData = data;

  if (hpGain > 0) {
    broadcastPartyHp(map, character);
    if (character.row.hidden !== 1) {
      const recover = new RecoverAgreeServerPacket();
      recover.playerId = character.playerId;
      recover.healHp = hpGain;
      recover.hpPercentage = hpPercentage(character);
      map.broadcastNearPlayer(recover, character.playerId);
    }
  }
  return true;
}

function teleportTarget(context: UseContext): { mapId: number; x: number; y: number } {
  const { map, character, record } = context;
  if (record.spec1 !== 0) return { mapId: record.spec1, x: record.spec2, y: record.spec3 };
  const inn = map.deps.pubData.inns?.inns.find((i) => i.name === character.row.home);
  if (inn !== undefined) return { mapId: inn.spawnMap, x: inn.spawnX, y: inn.spawnY };
  const { rescueMap, rescueX, rescueY } = map.deps.config.world;
  return { mapId: rescueMap, x: rescueX, y: rescueY };
}

function useTeleport(context: UseContext): boolean {
  const { map, player, character } = context;
  if (!map.emf.canScroll || player.frozen || warpPending(player)) return false;
  const target = teleportTarget(context);
  if (map.deps.getMap !== undefined && map.deps.getMap(target.mapId) === undefined) return false;
  player.requestWarp(
    target.mapId,
    target.x,
    target.y,
    character.mapId === target.mapId,
    WarpEffect.Scroll,
  );
  return true;
}

function useAlcohol(): boolean {
  return true;
}

function useEffectPotion({ map, character, record, reply }: UseContext): boolean {
  if (!Number.isInteger(record.spec1) || record.spec1 < 0 || record.spec1 >= SHORT_MAX) return false;
  const data = new ItemReplyServerPacket.ItemTypeDataEffectPotion();
  data.effectId = record.spec1;
  reply.itemTypeData = data;
  if (character.row.hidden !== 1) {
    const effect = new PlayerEffect();
    effect.playerId = character.playerId;
    effect.effectId = record.spec1;
    const packet = new EffectPlayerServerPacket();
    packet.effects = [effect];
    map.broadcastNearPlayer(packet, character.playerId);
  }
  return true;
}

function useHairDye({ map, character, record, reply }: UseContext): boolean {
  if (!isChar(record.spec1)) return false;
  character.row.hair_color = record.spec1;
  const data = new ItemReplyServerPacket.ItemTypeDataHairDye();
  data.hairColor = record.spec1;
  reply.itemTypeData = data;
  if (character.row.hidden !== 1) {
    const change = new AvatarChange();
    change.playerId = character.playerId;
    change.changeType = AvatarChangeType.HairColor;
    change.sound = false;
    const changeData = new AvatarChange.ChangeTypeDataHairColor();
    changeData.hairColor = record.spec1;
    change.changeTypeData = changeData;
    const packet = new AvatarAgreeServerPacket();
    packet.change = change;
    map.broadcastNearPlayer(packet, character.playerId);
  }
  return true;
}

function useExpReward({ map, character, record, reply }: UseContext): boolean {
  if (record.spec1 < 0) return false;
  const leveled = giveExperience(map, character, record.spec1);
  const data = new ItemReplyServerPacket.ItemTypeDataExpReward();
  data.experience = character.row.experience;
  data.levelUp = leveled ? character.row.level : 0;
  data.statPoints = character.row.stat_points;
  data.skillPoints = character.row.skill_points;
  data.maxHp = character.maxHp;
  data.maxTp = character.maxTp;
  data.maxSp = character.maxSp;
  reply.itemTypeData = data;
  if (leveled && character.row.hidden !== 1) {
    const accept = new ItemAcceptServerPacket();
    accept.playerId = character.playerId;
    map.broadcastNearPlayer(accept, character.playerId);
  }
  return true;
}

function useSpellScroll(context: UseContext): boolean {
  const { map, character, record } = context;
  const spellCount = map.deps.pubData.esf?.parsed.skills.length ?? 0;
  if (record.spec1 < 1 || record.spec1 > spellCount || !isChar(record.spec1)) return false;
  if (!character.spells.some((spell) => spell.id === record.spec1)) {
    const spell = new Spell();
    spell.id = record.spec1;
    spell.level = 1;
    character.spells.push(spell);
  }
  context.trailingChar = record.spec1;
  return true;
}

function useCureCurse({ map, character, reply }: UseContext): boolean {
  const { pubData, formulas, config } = map.deps;
  const destroyed = character.destroyCursedEquipment(pubData);
  if (destroyed.length === 0) return false;
  character.calculateStats(formulas, pubData, config.combat);

  const data = new ItemReplyServerPacket.ItemTypeDataCureCurse();
  data.stats = character.statsEquipmentChange();
  reply.itemTypeData = data;

  if (character.row.hidden !== 1 && destroyed.some((slot) => VISIBLE_SLOTS.has(slot))) {
    const packet = new AvatarAgreeServerPacket();
    packet.change = equipmentChange(map, character);
    map.broadcastNearPlayer(packet, character.playerId);
  }
  return true;
}

function useSkinPotion(context: UseContext): boolean {
  const { map, character, record } = context;
  if (!isChar(record.spec1)) return false;
  character.row.race = record.spec1;
  context.trailingChar = record.spec1;
  if (character.row.hidden === 1) return true;

  const change = new AvatarChange();
  change.playerId = character.playerId;
  change.changeType = AVATAR_CHANGE_TYPE_SKIN as AvatarChangeType;
  change.sound = false;
  const avatar = new AvatarAgreeServerPacket();
  avatar.change = change;
  const deepPacket = new TrailingCharPacket(avatar, record.spec1);

  const remove = new AvatarRemoveServerPacket();
  remove.playerId = character.playerId;
  const agree = new PlayersAgreeServerPacket();
  const nearby = new NearbyInfo();
  nearby.characters = [character.toMapInfo(map.deps.pubData)];
  nearby.npcs = [];
  nearby.items = [];
  agree.nearby = nearby;

  for (const [playerId, other] of map.characters) {
    const observer = map.players.get(playerId);
    if (observer === undefined) continue;
    if (!inClientRange(other.row.x, other.row.y, character.row.x, character.row.y)) continue;
    if (observer.isDeep) {
      observer.bus.send(deepPacket);
    } else if (playerId !== character.playerId) {
      observer.bus.send(remove);
      observer.bus.send(agree);
    }
  }
  return true;
}

const USE_HANDLERS: ReadonlyMap<number, UseHandler> = new Map<number, UseHandler>([
  [ItemType.Heal, useHeal],
  [ItemType.Teleport, useTeleport],
  [ItemType.Alcohol, useAlcohol],
  [ItemType.EffectPotion, useEffectPotion],
  [ItemType.HairDye, useHairDye],
  [ItemType.ExpReward, useExpReward],
  [ItemType.Reserved7, useSpellScroll],
  [ItemType.CureCurse, useCureCurse],
  [ItemType.Reserved5, useSkinPotion],
]);

function consumeAndReply(
  map: GameMap,
  player: Player,
  character: Character,
  itemId: number,
  reply: ItemReplyServerPacket,
  trailingChar: number | null,
): void {
  if (!isInfiniteUseItem(map.deps.config, itemId)) character.removeItem(itemId, 1);
  const used = new Item();
  used.id = itemId;
  used.amount = character.heldAmount(itemId);
  reply.usedItem = used;
  reply.weight = character.weight(map.deps.pubData);
  const packet: OutgoingPacket = trailingChar === null ? reply : new TrailingCharPacket(reply, trailingChar);
  player.bus.send(packet);
}

export function useItem(map: GameMap, player: Player, character: Character, itemId: number): void {
  if (character.heldAmount(itemId) === 0) {
    const agree = new ItemAgreeServerPacket();
    agree.itemId = itemId;
    player.bus.send(agree);
    return;
  }
  const record = map.deps.pubData.eif?.parsed.items[itemId - 1];
  if (record === undefined) return;
  const handler = USE_HANDLERS.get(record.type);
  if (handler === undefined) return;

  const reply = new ItemReplyServerPacket();
  reply.itemType = record.type;
  const context: UseContext = { map, player, character, itemId, record, reply, trailingChar: null };
  if (!handler(context)) return;
  consumeAndReply(map, player, character, itemId, reply, context.trailingChar);
}

export function useTitleItem(
  map: GameMap,
  player: Player,
  character: Character,
  itemId: number,
  title: string,
): void {
  if (character.heldAmount(itemId) === 0) return;
  const record = map.deps.pubData.eif?.parsed.items[itemId - 1];
  if (record === undefined || record.type !== ItemType.Reserved28) return;
  const maxLength = Math.min(map.deps.config.character.maxTitleLength, MAX_TITLE_COLUMN);
  if ([...title].length > maxLength) return;
  character.row.title = title;

  const reply = new ItemReplyServerPacket();
  reply.itemType = ItemType.Reserved28;
  consumeAndReply(map, player, character, itemId, reply, null);
}
