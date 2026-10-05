import {
  AttackPlayerServerPacket,
  AvatarReplyServerPacket,
  ItemSubtype,
  MapType,
  MessageOpenServerPacket,
  SitState,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import { step } from '../../coords.ts';
import { rollHit } from '../combat/formulas.ts';
import { hitNpc, isAttackableNpc, sendNpcHitReply } from '../combat/npc-hit.ts';
import { finishPlayerHit } from '../combat/player-hit.ts';
import { hpPercentage, isTargetable, partyMemberIds, publicPlayerId } from '../combat/targets.ts';
import { arenaAttack, arenaFor, isArenaPlayer } from '../events/arena.ts';
import type { GameMap } from '../game-map.ts';
import { npcKilled } from '../npc/kill-replies.ts';
import type { NpcInstance } from '../npc/npc.ts';
import { isWalkable } from '../tiles.ts';

type AttackTarget =
  | { kind: 'npc'; npc: NpcInstance }
  | { kind: 'player'; character: Character };

export function attack(map: GameMap, player: Player, character: Character, direction: number): void {
  character.direction = direction;

  const block = attackBlockedReason(map, character);
  if (block !== null) {
    const message = new MessageOpenServerPacket();
    message.message = block;
    player.bus.send(message);
    return;
  }

  if (character.row.hidden !== 1) {
    const packet = new AttackPlayerServerPacket();
    packet.playerId = character.playerId;
    packet.direction = direction;
    map.broadcastNear(packet, character.row.x, character.row.y, character.playerId);
  }

  const partyIds = partyMemberIds(map, character.playerId);
  const target = attackTarget(map, character, direction, partyIds);
  if (target === null) return;
  if (target.kind === 'npc') {
    attackNpc(map, player, character, target.npc, direction, partyIds);
  } else {
    attackPlayer(map, player, character, target.character, direction);
  }
}

export function isPk(map: GameMap): boolean {
  if (map.emf.type === MapType.Pk) return true;
  return map.deps.config.world.globalPk && arenaFor(map) === undefined;
}

function weaponRange(map: GameMap, weaponId: number): number {
  return map.deps.config.combat.weaponRanges.find((w) => w.weapon === weaponId)?.range ?? 1;
}

function attackBlockedReason(map: GameMap, character: Character): string | null {
  if (map.deps.config.combat.enforceWeight && character.isOverweight(map.deps.pubData)) {
    return 'You are carrying too much to attack.';
  }
  const weaponConfig = map.deps.config.combat.weaponRanges.find(
    (w) => w.weapon === character.row.weapon,
  );
  if (weaponConfig?.arrows) {
    const shield = map.deps.pubData.eif?.parsed.items[character.row.shield - 1];
    if (shield === undefined || shield.subtype !== ItemSubtype.Arrows) {
      return 'You need arrows equipped to use this weapon.';
    }
  }
  return null;
}

function attackTarget(
  map: GameMap,
  character: Character,
  direction: number,
  partyIds: readonly number[],
): AttackTarget | null {
  const inArena = isArenaPlayer(map, character.playerId);
  const range = inArena ? 1 : weaponRange(map, character.row.weapon);
  const pk = isPk(map);
  let x = character.row.x;
  let y = character.row.y;
  for (let i = 0; i < range; i++) {
    const next = step(x, y, direction);
    if (!isWalkable(map, next.x, next.y)) break;
    x = next.x;
    y = next.y;

    for (const npc of map.npcs.values()) {
      if (npc.alive && npc.x === x && npc.y === y) return { kind: 'npc', npc };
    }

    for (const [victimId, victim] of map.characters) {
      if (
        victimId === character.playerId ||
        victim.row.x !== x ||
        victim.row.y !== y ||
        partyIds.includes(victimId) ||
        !isTargetable(map, victim)
      ) {
        continue;
      }
      if (pk || (inArena && isArenaPlayer(map, victimId))) {
        return { kind: 'player', character: victim };
      }
    }
  }
  return null;
}

function attackPlayer(
  map: GameMap,
  player: Player,
  character: Character,
  victim: Character,
  direction: number,
): void {
  if (isArenaPlayer(map, character.playerId)) {
    arenaAttack(map, player, character, victim, direction);
    return;
  }
  if (isPk(map)) attackPlayerPk(map, player, character, victim, direction);
}

function attackPlayerPk(
  map: GameMap,
  player: Player,
  character: Character,
  victim: Character,
  direction: number,
): void {
  const stats = character.computed;
  const damage = rollHit(map.deps.formulas, {
    minDamage: stats.minDamage,
    maxDamage: stats.maxDamage,
    critical: victim.row.hp === victim.maxHp || Math.abs(victim.direction - direction) !== 2,
    accuracy: stats.accuracy,
    targetArmor: victim.computed.armor,
    targetEvade: victim.computed.evade,
    targetSitting: victim.row.sitting !== SitState.Stand,
    targetHp: victim.row.hp,
  });
  victim.row.hp -= damage;

  const build = (playerId: number): AvatarReplyServerPacket => {
    const reply = new AvatarReplyServerPacket();
    reply.playerId = playerId;
    reply.victimId = victim.playerId;
    reply.damage = damage;
    reply.direction = direction;
    reply.hpPercentage = hpPercentage(victim.row.hp, victim.maxHp);
    reply.dead = victim.row.hp === 0;
    return reply;
  };
  player.bus.send(build(character.playerId));
  map.broadcastNear(
    build(publicPlayerId(character)),
    character.row.x,
    character.row.y,
    character.playerId,
  );

  finishPlayerHit(map, player, character, victim);
}

function attackNpc(
  map: GameMap,
  player: Player,
  character: Character,
  npc: NpcInstance,
  direction: number,
  partyIds: readonly number[],
): void {
  if (!isAttackableNpc(npc)) return;

  const stats = character.computed;
  const hit = hitNpc(map, npc, character.playerId, partyIds, {
    minDamage: stats.minDamage,
    maxDamage: stats.maxDamage,
    accuracy: stats.accuracy,
    critical: npc.hp === npc.maxHp || Math.abs(npc.direction - direction) !== 2,
  });

  if (npc.hp > 0) {
    sendNpcHitReply(map, player, character, npc, direction, hit);
    return;
  }
  npcKilled(map, player, character, npc, direction, hit.damage);
}
