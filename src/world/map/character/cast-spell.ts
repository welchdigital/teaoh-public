import {
  AvatarAdminServerPacket,
  GroupHealTargetPlayer,
  RecoverPlayerServerPacket,
  SitState,
  SkillTargetRestrict,
  SkillTargetType,
  SkillType,
  SpellRequestServerPacket,
  SpellTargetGroupServerPacket,
  SpellTargetOtherServerPacket,
  SpellTargetSelfServerPacket,
  type EsfRecord,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import { inClientRange, inRange } from '../../coords.ts';
import { rollHit } from '../combat/formulas.ts';
import { hitNpc, isAttackableNpc, sendNpcHitReply } from '../combat/npc-hit.ts';
import { finishPlayerHit } from '../combat/player-hit.ts';
import { hpPercentage, isTargetable, partyMemberIds, publicPlayerId } from '../combat/targets.ts';
import type { GameMap } from '../game-map.ts';
import { npcKilled } from '../npc/kill-replies.ts';
import { broadcastPartyHp } from '../party-hp.ts';
import { isPk } from './attack.ts';

export type SpellTarget =
  | { kind: 'self' }
  | { kind: 'group' }
  | { kind: 'player'; playerId: number }
  | { kind: 'npc'; npcIndex: number };

export function spellRecord(map: GameMap, spellId: number): EsfRecord | undefined {
  if (spellId <= 0) return undefined;
  return map.deps.pubData.esf?.parsed.skills[spellId - 1];
}

export function startSpellChant(map: GameMap, character: Character, spellId: number): void {
  if (!character.spells.some((s) => s.id === spellId)) return;
  if (character.row.hidden === 1) return;
  const packet = new SpellRequestServerPacket();
  packet.playerId = character.playerId;
  packet.spellId = spellId;
  map.broadcastNear(packet, character.row.x, character.row.y, character.playerId);
}

export function castSpell(
  map: GameMap,
  player: Player,
  character: Character,
  spellId: number,
  target: SpellTarget,
): void {
  if (!character.spells.some((s) => s.id === spellId)) return;
  const spell = spellRecord(map, spellId);
  if (spell === undefined) return;

  if (spell.type === SkillType.Heal) {
    castHealSpell(map, player, character, spellId, spell, target);
  } else if (spell.type === SkillType.Attack) {
    castDamageSpell(map, player, character, spellId, spell, target);
  }
}

function castHealSpell(
  map: GameMap,
  player: Player,
  character: Character,
  spellId: number,
  spell: EsfRecord,
  target: SpellTarget,
): void {
  if (spell.targetRestrict !== SkillTargetRestrict.Friendly) return;
  switch (target.kind) {
    case 'self':
      castHealSelf(map, player, character, spellId, spell);
      return;
    case 'group':
      castHealGroup(map, character, spellId, spell);
      return;
    case 'player':
      castHealPlayer(map, player, character, target.playerId, spellId, spell);
      return;
    default:
      return;
  }
}

function sendRecover(player: Player, character: Character): void {
  const packet = new RecoverPlayerServerPacket();
  packet.hp = character.row.hp;
  packet.tp = character.row.tp;
  player.bus.send(packet);
}

function heal(map: GameMap, character: Character, amount: number): void {
  const original = character.row.hp;
  character.row.hp = Math.min(character.row.hp + amount, character.maxHp);
  if (character.row.hp !== original) broadcastPartyHp(map, character);
}

function castHealSelf(
  map: GameMap,
  player: Player,
  character: Character,
  spellId: number,
  spell: EsfRecord,
): void {
  if (spell.targetType !== SkillTargetType.Self) return;
  if (character.row.tp < spell.tpCost) return;

  character.row.tp -= spell.tpCost;
  heal(map, character, spell.hpHeal);

  const build = (): SpellTargetSelfServerPacket => {
    const packet = new SpellTargetSelfServerPacket();
    packet.playerId = character.playerId;
    packet.spellId = spellId;
    packet.spellHealHp = spell.hpHeal;
    packet.hpPercentage = hpPercentage(character.row.hp, character.maxHp);
    return packet;
  };
  const own = build();
  own.hp = character.row.hp;
  own.tp = character.row.tp;
  player.bus.send(own);

  if (character.row.hidden !== 1) {
    map.broadcastNear(build(), character.row.x, character.row.y, character.playerId);
  }
}

function castHealGroup(
  map: GameMap,
  character: Character,
  spellId: number,
  spell: EsfRecord,
): void {
  if (spell.targetType !== SkillTargetType.Group) return;
  if (character.row.tp < spell.tpCost) return;
  const partyIds = partyMemberIds(map, character.playerId);
  if (partyIds.length === 0) return;

  character.row.tp -= spell.tpCost;

  const healed: Character[] = [];
  for (const memberId of partyIds) {
    const member = map.characters.get(memberId);
    if (member === undefined) continue;
    heal(map, member, spell.hpHeal);
    healed.push(member);
  }

  for (const [observerId, observerPlayer] of map.players) {
    const observer = map.characters.get(observerId);
    if (observer === undefined) continue;
    if (character.row.hidden === 1 && !partyIds.includes(observerId)) continue;
    const players = healed
      .filter(
        (member) =>
          member.playerId === observerId ||
          inClientRange(observer.row.x, observer.row.y, member.row.x, member.row.y),
      )
      .map((member) => {
        const entry = new GroupHealTargetPlayer();
        entry.playerId = member.playerId;
        entry.hpPercentage = hpPercentage(member.row.hp, member.maxHp);
        entry.hp = member.row.hp;
        return entry;
      });
    if (players.length === 0) continue;
    const packet = new SpellTargetGroupServerPacket();
    packet.spellId = spellId;
    packet.casterId = character.playerId;
    packet.casterTp = character.row.tp;
    packet.spellHealHp = spell.hpHeal;
    packet.players = players;
    observerPlayer.bus.send(packet);
  }
}

function castHealPlayer(
  map: GameMap,
  player: Player,
  character: Character,
  targetId: number,
  spellId: number,
  spell: EsfRecord,
): void {
  if (spell.targetType !== SkillTargetType.Normal) return;
  const target = map.characters.get(targetId);
  const targetPlayer = map.players.get(targetId);
  if (target === undefined || targetPlayer === undefined) return;
  if (target.row.hp <= 0) return;
  if (!inRange(character.row.x, character.row.y, target.row.x, target.row.y)) return;
  if (character.row.tp < spell.tpCost) return;

  character.row.tp -= spell.tpCost;
  heal(map, target, spell.hpHeal);

  const build = (): SpellTargetOtherServerPacket => {
    const packet = new SpellTargetOtherServerPacket();
    packet.victimId = target.playerId;
    packet.casterId = character.playerId;
    packet.casterDirection = character.direction;
    packet.spellId = spellId;
    packet.spellHealHp = spell.hpHeal;
    packet.hpPercentage = hpPercentage(target.row.hp, target.maxHp);
    return packet;
  };
  if (character.row.hidden !== 1) {
    map.broadcastNear(build(), target.row.x, target.row.y, target.playerId);
  } else if (target.playerId !== character.playerId) {
    player.bus.send(build());
  }
  const withHp = build();
  withHp.hp = target.row.hp;
  targetPlayer.bus.send(withHp);

  sendRecover(player, character);
}

function castDamageSpell(
  map: GameMap,
  player: Player,
  character: Character,
  spellId: number,
  spell: EsfRecord,
  target: SpellTarget,
): void {
  if (spell.targetRestrict === SkillTargetRestrict.Friendly) return;
  if (spell.targetType !== SkillTargetType.Normal) return;
  if (target.kind === 'npc') {
    castDamageNpc(map, player, character, target.npcIndex, spellId, spell);
  } else if (target.kind === 'player') {
    castDamagePlayer(map, player, character, target.playerId, spellId, spell);
  }
}

function castDamageNpc(
  map: GameMap,
  player: Player,
  character: Character,
  npcIndex: number,
  spellId: number,
  spell: EsfRecord,
): void {
  if (character.row.tp < spell.tpCost) return;
  const npc = map.npcs.get(npcIndex);
  if (npc === undefined || !npc.alive || !isAttackableNpc(npc)) return;
  if (!inRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  character.row.tp -= spell.tpCost;

  const stats = character.computed;
  const hit = hitNpc(map, npc, character.playerId, partyMemberIds(map, character.playerId), {
    minDamage: stats.minDamage + spell.minDamage,
    maxDamage: stats.maxDamage + spell.maxDamage,
    accuracy: stats.accuracy,
    critical: npc.hp === npc.maxHp,
  });

  sendRecover(player, character);

  if (npc.hp > 0) {
    sendNpcHitReply(map, player, character, npc, character.direction, hit, spellId);
    return;
  }
  npcKilled(map, player, character, npc, character.direction, hit.damage, spellId);
}

function castDamagePlayer(
  map: GameMap,
  player: Player,
  character: Character,
  victimId: number,
  spellId: number,
  spell: EsfRecord,
): void {
  if (spell.targetRestrict === SkillTargetRestrict.Npc) return;
  if (!isPk(map) || victimId === character.playerId) return;
  if (character.row.tp < spell.tpCost) return;
  if (partyMemberIds(map, character.playerId).includes(victimId)) return;
  const victim = map.characters.get(victimId);
  if (victim === undefined || !isTargetable(map, victim)) return;
  if (!inRange(character.row.x, character.row.y, victim.row.x, victim.row.y)) return;

  const stats = character.computed;
  const damage = rollHit(map.deps.formulas, {
    minDamage: stats.minDamage + spell.minDamage,
    maxDamage: stats.maxDamage + spell.maxDamage,
    critical: victim.row.hp === victim.maxHp,
    accuracy: stats.accuracy,
    targetArmor: victim.computed.armor,
    targetEvade: victim.computed.evade,
    targetSitting: victim.row.sitting !== SitState.Stand,
    targetHp: victim.row.hp,
  });
  victim.row.hp -= damage;
  character.row.tp -= spell.tpCost;
  sendRecover(player, character);

  const build = (casterId: number): AvatarAdminServerPacket => {
    const packet = new AvatarAdminServerPacket();
    packet.casterId = casterId;
    packet.victimId = victim.playerId;
    packet.casterDirection = character.direction;
    packet.damage = damage;
    packet.hpPercentage = hpPercentage(victim.row.hp, victim.maxHp);
    packet.victimDied = victim.row.hp === 0;
    packet.spellId = spellId;
    return packet;
  };
  player.bus.send(build(character.playerId));
  map.broadcastNear(
    build(publicPlayerId(character)),
    victim.row.x,
    victim.row.y,
    character.playerId,
  );

  finishPlayerHit(map, player, character, victim);
}
