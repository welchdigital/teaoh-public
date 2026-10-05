import {
  CastAcceptServerPacket,
  CastSpecServerPacket,
  Coords,
  NpcAcceptServerPacket,
  NpcJunkServerPacket,
  NpcKilledData,
  NpcSpecServerPacket,
  PartyExpShare,
  PartyTargetGroupServerPacket,
  RecoverReplyServerPacket,
  RecoverTargetGroupServerPacket,
} from 'eolib';
import { MAX_EXPERIENCE, type Character } from '../../../character/character.ts';
import { MAX_DROP_AMOUNT, MAX_DROP_ITEM_ID } from '../../../data/drops.ts';
import type { Formulas } from '../../../data/formulas.ts';
import { BossPingServerPacket } from '../../../deep/index.ts';
import { log } from '../../../log.ts';
import type { Player } from '../../../player/player.ts';
import { killedNpc } from '../../../quest/engine.ts';
import { inClientRange, inRange } from '../../coords.ts';
import { giveExperience, levelUpStats } from '../character/experience.ts';
import { publicPlayerId } from '../combat/targets.ts';
import type { GameMap, MapItem } from '../game-map.ts';
import { addItem } from '../items.ts';
import type { NpcInstance } from './npc.ts';

export interface ExpGain {
  playerId: number;
  leveledUp: boolean;
  level: number;
  experienceGained: number;
  totalExperience: number;
}

function bossPing(npc: NpcInstance, killed: boolean): BossPingServerPacket {
  const ping = new BossPingServerPacket();
  ping.npcIndex = npc.index;
  ping.npcId = npc.id;
  ping.hp = killed ? 0 : npc.hp;
  ping.hpPercentage = killed ? 0 : npc.hpPercentage();
  ping.killed = killed;
  return ping;
}

export function sendBossPing(map: GameMap, npc: NpcInstance, killed: boolean): void {
  if (!npc.isBoss) return;
  const ping = bossPing(npc, killed);
  for (const [playerId, player] of map.players) {
    const character = map.characters.get(playerId);
    if (
      player.isDeep &&
      character !== undefined &&
      inClientRange(character.row.x, character.row.y, npc.x, npc.y)
    ) {
      player.bus.send(ping);
    }
  }
}

export function partyExpShare(formulas: Formulas, members: number, experience: number): number {
  const fallback =
    members > 2
      ? Math.floor(experience * ((1 + members) / members))
      : Math.floor(experience / 2);
  const share = Math.floor(formulas.eval('party_exp_share', { members, exp: experience }, fallback));
  return Number.isFinite(share) ? Math.min(Math.max(0, share), MAX_EXPERIENCE) : 0;
}

function gainExperience(map: GameMap, character: Character, experience: number): ExpGain {
  const scaled = Math.trunc(experience * map.deps.config.world.expMultiplier);
  const gained = Number.isFinite(scaled) ? Math.min(Math.max(0, scaled), MAX_EXPERIENCE) : 0;
  const before = character.row.experience;
  const leveledUp = giveExperience(map, character, gained);
  return {
    playerId: character.playerId,
    leveledUp,
    level: character.row.level,
    experienceGained: Math.max(0, character.row.experience - before),
    totalExperience: character.row.experience,
  };
}

function sharesExperience(member: Character, killer: Character, npc: NpcInstance): boolean {
  if (member.playerId === killer.playerId) return true;
  const { x, y } = member.row;
  return inClientRange(x, y, npc.x, npc.y) || inClientRange(x, y, killer.row.x, killer.row.y);
}

function shareExperience(
  map: GameMap,
  character: Character,
  npc: NpcInstance,
): { gains: ExpGain[]; partyIds: number[] | null } {
  const party = map.deps.parties?.partyOf(character.playerId);
  if (party === undefined) {
    return { gains: [gainExperience(map, character, npc.data.experience)], partyIds: null };
  }
  const sharing = party.memberIds
    .map((id) => map.characters.get(id))
    .filter(
      (member): member is Character =>
        member !== undefined && sharesExperience(member, character, npc),
    );
  const experience =
    sharing.length > 1
      ? partyExpShare(map.deps.formulas, sharing.length, npc.data.experience)
      : npc.data.experience;
  return {
    gains: sharing.map((member) => gainExperience(map, member, experience)),
    partyIds: [...party.memberIds],
  };
}

function sendPartyLevelUps(map: GameMap, gains: readonly ExpGain[], killerId: number): void {
  for (const gain of gains) {
    if (!gain.leveledUp || gain.playerId === killerId) continue;
    const character = map.characters.get(gain.playerId);
    const player = map.players.get(gain.playerId);
    if (character === undefined || player === undefined) continue;

    const stats = new RecoverTargetGroupServerPacket();
    stats.statPoints = character.row.stat_points;
    stats.skillPoints = character.row.skill_points;
    stats.maxHp = character.maxHp;
    stats.maxTp = character.maxTp;
    stats.maxSp = character.maxSp;
    player.bus.send(stats);

    const reply = new RecoverReplyServerPacket();
    reply.experience = character.row.experience;
    reply.karma = character.row.karma;
    reply.levelUp = character.row.level;
    reply.statPoints = character.row.stat_points;
    reply.skillPoints = character.row.skill_points;
    player.bus.send(reply);
  }
}

function sendPartyExpShares(
  map: GameMap,
  gains: readonly ExpGain[],
  killerId: number,
  partyIds: readonly number[],
): void {
  const shares = gains
    .filter((gain) => gain.playerId !== killerId)
    .map((gain) => {
      const share = new PartyExpShare();
      share.playerId = gain.playerId;
      share.experience = gain.experienceGained;
      share.levelUp = gain.leveledUp ? gain.level : 0;
      return share;
    });
  if (shares.length === 0) return;

  for (const [playerId, player] of map.players) {
    if (playerId === killerId || partyIds.includes(playerId)) continue;
    const observer = map.characters.get(playerId);
    if (observer === undefined) continue;
    const visible = shares.filter((share) => {
      const member = map.characters.get(share.playerId);
      return (
        share.levelUp > 0 &&
        member !== undefined &&
        member.row.hidden !== 1 &&
        inClientRange(observer.row.x, observer.row.y, member.row.x, member.row.y)
      );
    });
    if (visible.length === 0) continue;
    const packet = new PartyTargetGroupServerPacket();
    packet.gains = visible;
    player.bus.send(packet);
  }

  const packet = new PartyTargetGroupServerPacket();
  packet.gains = shares;
  for (const memberId of partyIds) {
    (map.players.get(memberId) ?? map.deps.getPlayer?.(memberId))?.bus.send(packet);
  }
}

function buildKilledData(
  npc: NpcInstance,
  killerId: number,
  direction: number,
  damage: number,
  item: MapItem | null,
): NpcKilledData {
  const killData = new NpcKilledData();
  killData.killerId = killerId;
  killData.killerDirection = direction;
  killData.npcIndex = npc.index;
  killData.damage = damage;
  killData.dropIndex = item?.index ?? 0;
  killData.dropId = item?.id ?? 0;
  killData.dropAmount = item?.amount ?? 0;
  const coords = new Coords();
  coords.x = item?.x ?? npc.x;
  coords.y = item?.y ?? npc.y;
  killData.dropCoords = coords;
  return killData;
}

function sendKillNotices(
  map: GameMap,
  character: Character,
  npc: NpcInstance,
  kill: { direction: number; damage: number; item: MapItem | null },
  gains: readonly ExpGain[],
  spellId: number | undefined,
): void {
  const killerId = character.playerId;
  const leveledUp = gains.some((gain) => gain.playerId === killerId && gain.leveledUp);
  const levelUp = leveledUp ? levelUpStats(character) : null;
  const ownData = buildKilledData(npc, killerId, kill.direction, kill.damage, kill.item);
  const publicData = buildKilledData(
    npc,
    publicPlayerId(character),
    kill.direction,
    kill.damage,
    kill.item,
  );

  for (const [playerId, player] of map.players) {
    const observer = map.characters.get(playerId);
    const isKiller = playerId === killerId;
    if (
      !isKiller &&
      (observer === undefined || !inRange(observer.row.x, observer.row.y, npc.x, npc.y))
    ) {
      continue;
    }
    const killData = isKiller ? ownData : publicData;

    if (spellId !== undefined) {
      if (leveledUp) {
        const packet = new CastAcceptServerPacket();
        packet.spellId = spellId;
        packet.npcKilledData = killData;
        if (isKiller) {
          packet.casterTp = character.row.tp;
          packet.experience = character.row.experience;
          packet.levelUp = levelUp;
        }
        player.bus.send(packet);
      } else {
        const packet = new CastSpecServerPacket();
        packet.spellId = spellId;
        packet.npcKilledData = killData;
        if (isKiller) {
          packet.casterTp = character.row.tp;
          packet.experience = character.row.experience;
        }
        player.bus.send(packet);
      }
    } else if (leveledUp) {
      const packet = new NpcAcceptServerPacket();
      packet.npcKilledData = killData;
      if (isKiller) {
        packet.experience = character.row.experience;
        packet.levelUp = levelUp;
      }
      player.bus.send(packet);
    } else {
      const packet = new NpcSpecServerPacket();
      packet.npcKilledData = killData;
      if (isKiller) packet.experience = character.row.experience;
      player.bus.send(packet);
    }
  }
}

function isDroppable(map: GameMap, itemId: number, amount: number): boolean {
  if (!Number.isInteger(itemId) || itemId <= 0 || itemId > MAX_DROP_ITEM_ID) return false;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_DROP_AMOUNT) return false;
  const eif = map.deps.pubData.eif;
  if (eif === null || eif === undefined) return true;
  if (eif.parsed.items[itemId - 1] !== undefined) return true;
  log.warn({ map: map.id, itemId }, 'drop skipped: item is not in the item pub');
  return false;
}

function killChildren(map: GameMap, boss: NpcInstance): void {
  const childIds = new Set<number>();
  for (const npc of map.npcs.values()) {
    if (!npc.isChild) continue;
    childIds.add(npc.id);
    npc.die();
  }
  for (const npcId of childIds) {
    const junk = new NpcJunkServerPacket();
    junk.npcId = npcId;
    map.broadcast(junk);
  }
  sendBossPing(map, boss, true);
}

export function npcKilled(
  map: GameMap,
  player: Player,
  character: Character,
  npc: NpcInstance,
  direction: number,
  damage: number,
  spellId?: number,
): void {
  npc.die();
  log.info(
    { cat: 'npc_kill', killer: character.name, npc: npc.data.name, npcId: npc.id, map: map.id },
    'npc killed',
  );

  const { gains, partyIds } = shareExperience(map, character, npc);

  const drop = map.deps.drops.roll(npc.id);
  const item =
    drop !== null && isDroppable(map, drop.itemId, drop.amount)
      ? addItem(
          map,
          drop.itemId,
          drop.amount,
          npc.x,
          npc.y,
          character.playerId,
          map.deps.config.world.dropProtectNpc,
        )
      : null;

  if (partyIds !== null) {
    sendPartyLevelUps(map, gains, character.playerId);
    sendPartyExpShares(map, gains, character.playerId, partyIds);
  }

  sendKillNotices(map, character, npc, { direction, damage, item }, gains, spellId);

  if (npc.isBoss) killChildren(map, npc);

  for (const gain of gains) {
    const member = gain.playerId === character.playerId ? player : map.players.get(gain.playerId);
    if (member !== undefined) killedNpc(member, npc.id);
  }
}
