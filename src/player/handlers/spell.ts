import {
  EoReader,
  PacketAction,
  SpellRequestClientPacket,
  SpellTargetGroupClientPacket,
  SpellTargetOtherClientPacket,
  SpellTargetSelfClientPacket,
  SpellTargetType,
} from 'eolib';
import { log } from '../../log.ts';
import {
  castSpell,
  spellRecord,
  startSpellChant,
  type SpellTarget,
} from '../../world/map/character/cast-spell.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { timestampDiff } from '../timestamp.ts';

const TIMESTAMP_UNIT_MS = 10;

function inGame(player: Player): boolean {
  return (
    player.state === ClientState.InGame &&
    player.character !== null &&
    player.map !== null &&
    !player.isDying &&
    player.captcha === null
  );
}

export function minCastDelay(castTime: number): number {
  return (castTime - 1) * 47 + 35;
}

export function validCastTime(castTime: number, diff: number): boolean {
  return diff >= minCastDelay(castTime) && diff < Math.max(castTime, 1) * 50;
}

export function minCastMillis(castTime: number, slack: number): number {
  return Math.max(0, minCastDelay(castTime) * TIMESTAMP_UNIT_MS - Math.max(0, slack));
}

function takeChant(player: Player, spellId: number, timestamp: number): boolean {
  const chant = player.spellChant;
  player.spellChant = null;
  if (chant === null || chant.spellId !== spellId) return false;
  const map = player.map!;
  const spell = spellRecord(map, spellId);
  if (spell === undefined) return false;
  if (!validCastTime(spell.castTime, timestampDiff(timestamp, chant.timestamp))) return false;
  const elapsed = Date.now() - chant.startedAt;
  if (elapsed < minCastMillis(spell.castTime, map.deps.config.combat.castTimeSlack)) return false;
  if (timestampDiff(timestamp, player.timestamp) > 0) player.timestamp = timestamp;
  return true;
}

function cast(player: Player, spellId: number, timestamp: number, target: SpellTarget): void {
  if (!inGame(player)) {
    player.spellChant = null;
    return;
  }
  if (!takeChant(player, spellId, timestamp)) return;
  castSpell(player.map!, player, player.character!, spellId, target);
}

function request(player: Player, reader: EoReader): void {
  const packet = SpellRequestClientPacket.deserialize(reader);
  player.spellChant = null;
  if (!inGame(player) || packet.spellId <= 0) return;
  if (timestampDiff(packet.timestamp, player.timestamp) < 0) return;

  player.spellChant = {
    spellId: packet.spellId,
    timestamp: packet.timestamp,
    startedAt: Date.now(),
  };
  startSpellChant(player.map!, player.character!, packet.spellId);
}

function targetSelf(player: Player, reader: EoReader): void {
  const packet = SpellTargetSelfClientPacket.deserialize(reader);
  cast(player, packet.spellId, packet.timestamp, { kind: 'self' });
}

function targetOther(player: Player, reader: EoReader): void {
  const packet = SpellTargetOtherClientPacket.deserialize(reader);
  if (packet.targetType === SpellTargetType.Player) {
    cast(player, packet.spellId, packet.timestamp, { kind: 'player', playerId: packet.victimId });
  } else if (packet.targetType === SpellTargetType.Npc) {
    cast(player, packet.spellId, packet.timestamp, { kind: 'npc', npcIndex: packet.victimId });
  } else {
    player.spellChant = null;
  }
}

function targetGroup(player: Player, reader: EoReader): void {
  const packet = SpellTargetGroupClientPacket.deserialize(reader);
  cast(player, packet.spellId, packet.timestamp, { kind: 'group' });
}

export function handleSpell(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      request(player, reader);
      break;
    case PacketAction.TargetSelf:
      targetSelf(player, reader);
      break;
    case PacketAction.TargetOther:
      targetOther(player, reader);
      break;
    case PacketAction.TargetGroup:
      targetGroup(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Spell action');
  }
}
