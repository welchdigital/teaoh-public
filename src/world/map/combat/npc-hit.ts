import {
  CastReplyServerPacket,
  NpcKillStealProtectionState,
  NpcReplyServerPacket,
  NpcType,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import type { GameMap } from '../game-map.ts';
import { dropOpponents } from '../npc/act.ts';
import { sendBossPing } from '../npc/kill-replies.ts';
import type { NpcInstance } from '../npc/npc.ts';
import { rollHit } from './formulas.ts';
import { publicPlayerId } from './targets.ts';

export interface NpcHitRoll {
  minDamage: number;
  maxDamage: number;
  accuracy: number;
  critical: boolean;
}

export interface NpcHit {
  damage: number;
  protected: boolean;
}

export function isAttackableNpc(npc: NpcInstance): boolean {
  return npc.data.type === NpcType.Passive || npc.data.type === NpcType.Aggressive;
}

export function isKillStealProtected(
  npc: NpcInstance,
  playerId: number,
  partyIds: readonly number[],
): boolean {
  return (
    npc.data.behaviorId === 0 &&
    npc.opponents.length > 0 &&
    !npc.opponents.some((o) => o.playerId === playerId || partyIds.includes(o.playerId))
  );
}

function propagateBossOpponents(map: GameMap, boss: NpcInstance, playerId: number, damage: number): void {
  for (const child of map.npcs.values()) {
    if (!child.isChild || !child.alive) continue;
    for (const opponent of boss.opponents) {
      const existing = child.opponents.find((o) => o.playerId === opponent.playerId);
      if (existing !== undefined) {
        existing.boredTicks = 0;
        if (existing.playerId === playerId) existing.damageDealt += damage;
      } else {
        child.opponents.push({ ...opponent });
      }
    }
  }
}

export function hitNpc(
  map: GameMap,
  npc: NpcInstance,
  playerId: number,
  partyIds: readonly number[],
  roll: NpcHitRoll,
): NpcHit {
  dropOpponents(map, npc);
  if (isKillStealProtected(npc, playerId, partyIds)) return { damage: 0, protected: true };

  const damage = rollHit(map.deps.formulas, {
    minDamage: roll.minDamage,
    maxDamage: roll.maxDamage,
    critical: roll.critical,
    accuracy: roll.accuracy,
    targetArmor: npc.data.armor,
    targetEvade: npc.data.evade,
    targetSitting: false,
    targetHp: npc.hp,
  });
  npc.hp -= damage;
  if (npc.hp > 0) npc.addOpponentDamage(playerId, damage);
  if (npc.isBoss) propagateBossOpponents(map, npc, playerId, damage);
  return { damage, protected: false };
}

export function sendNpcHitReply(
  map: GameMap,
  player: Player,
  character: Character,
  npc: NpcInstance,
  direction: number,
  hit: NpcHit,
  spellId?: number,
): void {
  const protection = hit.protected
    ? NpcKillStealProtectionState.Protected
    : NpcKillStealProtectionState.Unprotected;

  if (spellId === undefined) {
    const build = (playerId: number): NpcReplyServerPacket => {
      const reply = new NpcReplyServerPacket();
      reply.playerId = playerId;
      reply.playerDirection = direction;
      reply.npcIndex = npc.index;
      reply.damage = hit.damage;
      reply.hpPercentage = npc.hpPercentage();
      return reply;
    };
    const own = build(character.playerId);
    own.killStealProtection = protection;
    player.bus.send(own);
    map.broadcastNear(build(publicPlayerId(character)), npc.x, npc.y, character.playerId);
  } else {
    const build = (casterId: number): CastReplyServerPacket => {
      const reply = new CastReplyServerPacket();
      reply.spellId = spellId;
      reply.casterId = casterId;
      reply.casterDirection = direction;
      reply.npcIndex = npc.index;
      reply.damage = hit.damage;
      reply.hpPercentage = npc.hpPercentage();
      return reply;
    };
    const own = build(character.playerId);
    own.casterTp = character.row.tp;
    own.killStealProtection = protection;
    player.bus.send(own);
    map.broadcastNear(build(publicPlayerId(character)), npc.x, npc.y, character.playerId);
  }

  sendBossPing(map, npc, false);
}
