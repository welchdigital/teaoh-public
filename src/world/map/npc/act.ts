import {
  Direction,
  NpcPlayerServerPacket,
  NpcType,
  NpcUpdateAttack,
  NpcUpdateChat,
  NpcUpdatePosition,
  PlayerKilledState,
  SitState,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { directionTo, distance, inRange, step } from '../../coords.ts';
import { rollHit } from '../combat/formulas.ts';
import { hpPercentage, isTargetable } from '../combat/targets.ts';
import type { GameMap } from '../game-map.ts';
import { randomRange } from '../math.ts';
import { broadcastPartyHp } from '../party-hp.ts';
import { isNpcWalkable, isOccupied } from '../tiles.ts';
import type { NpcInstance } from './npc.ts';

export function npcSpeed(map: GameMap, npc: NpcInstance): number {
  return map.deps.config.npcs.speeds[npc.spawnType] ?? 0;
}

export function dropOpponents(map: GameMap, npc: NpcInstance): void {
  npc.dropOpponents(map.deps.config.npcs.boredTimer, (playerId) => map.characters.has(playerId));
}

export function actNpcs(map: GameMap): void {
  if (map.npcs.size === 0) return;
  const settings = map.deps.config.npcs;
  if (settings.freezeOnEmptyMap && map.players.size === 0) return;

  const positions: NpcUpdatePosition[] = [];
  const attacks: NpcUpdateAttack[] = [];
  const chats: NpcUpdateChat[] = [];
  const killedPlayers = new Set<number>();

  for (const npc of map.npcs.values()) {
    if (!npc.alive) continue;

    for (const opponent of npc.opponents) opponent.boredTicks += settings.actRate;
    dropOpponents(map, npc);
    npc.actTicks += settings.actRate;
    npc.talkTicks += settings.actRate;

    const chat = actNpcTalk(map, npc);
    if (chat !== null) chats.push(chat);

    const speed = npcSpeed(map, npc);
    if (speed <= 0 || npc.actTicks <= 0 || npc.actTicks < speed) continue;

    const attack = actNpcAttack(map, npc);
    if (attack !== null) {
      attacks.push(attack);
      if (attack.killed === PlayerKilledState.Killed) killedPlayers.add(attack.playerId);
      continue;
    }

    const move = actNpcMove(map, npc, speed);
    if (move !== null) positions.push(move);
  }

  if (positions.length > 0 || attacks.length > 0 || chats.length > 0) {
    for (const [playerId, player] of map.players) {
      const character = map.characters.get(playerId);
      if (character === undefined) continue;
      const near = (update: { npcIndex: number }): boolean => {
        const npc = map.npcs.get(update.npcIndex);
        return npc !== undefined && inRange(character.row.x, character.row.y, npc.x, npc.y);
      };
      const packet = new NpcPlayerServerPacket();
      packet.positions = positions.filter(near);
      packet.attacks = attacks.filter(near);
      packet.chats = chats.filter(near);
      if (packet.positions.length > 0 || packet.attacks.length > 0 || packet.chats.length > 0) {
        player.bus.send(packet);
      }
    }
  }

  for (const playerId of killedPlayers) {
    map.players.get(playerId)?.die();
  }
}

function actNpcTalk(map: GameMap, npc: NpcInstance): NpcUpdateChat | null {
  const record = map.deps.pubData.talk?.npcs.find((t) => t.npcId === npc.id);
  if (record === undefined || npc.talkTicks < map.deps.config.npcs.talkRate) return null;
  npc.talkTicks = 0;
  if (record.messages.length === 0 || randomRange(0, 100) > record.rate) return null;
  const chat = new NpcUpdateChat();
  chat.npcIndex = npc.index;
  chat.message = record.messages[randomRange(0, record.messages.length - 1)]?.message ?? '';
  return chat;
}

function actNpcAttack(map: GameMap, npc: NpcInstance): NpcUpdateAttack | null {
  const adjacent: Character[] = [];
  for (const character of map.characters.values()) {
    if (distance(npc.x, npc.y, character.row.x, character.row.y) > 1) continue;
    if (!isTargetable(map, character)) continue;
    adjacent.push(character);
  }
  if (adjacent.length === 0) return null;

  let target: Character | undefined;
  let bestDamage = -1;
  for (const opponent of npc.opponents) {
    const character = adjacent.find((c) => c.playerId === opponent.playerId);
    if (character !== undefined && opponent.damageDealt > bestDamage) {
      target = character;
      bestDamage = opponent.damageDealt;
    }
  }
  if (target === undefined && npc.data.type === NpcType.Aggressive) {
    target = adjacent[randomRange(0, adjacent.length - 1)];
  }
  if (target === undefined) return null;

  if (target.row.x !== npc.x || target.row.y !== npc.y) {
    npc.direction = directionTo(npc.x, npc.y, target.row.x, target.row.y);
  }
  npc.actTicks = 0;
  const damage = damagePlayer(map, npc, target);
  if (damage > 0) broadcastPartyHp(map, target);

  const killed = target.row.hp === 0;
  if (killed) npc.removeOpponent(target.playerId);

  const attack = new NpcUpdateAttack();
  attack.npcIndex = npc.index;
  attack.killed = killed ? PlayerKilledState.Killed : PlayerKilledState.Alive;
  attack.direction = npc.direction;
  attack.playerId = target.playerId;
  attack.damage = damage;
  attack.hpPercentage = hpPercentage(target.row.hp, target.maxHp);
  return attack;
}

function damagePlayer(map: GameMap, npc: NpcInstance, character: Character): number {
  if (character.row.hp <= 0) return 0;
  const stats = character.computed;
  const damage = rollHit(map.deps.formulas, {
    minDamage: npc.data.minDamage,
    maxDamage: npc.data.maxDamage,
    critical: Math.abs(character.direction - npc.direction) !== 2,
    accuracy: npc.data.accuracy,
    targetArmor: stats.armor,
    targetEvade: stats.evade,
    targetSitting: character.row.sitting !== SitState.Stand,
    targetHp: character.row.hp,
  });
  character.row.hp -= damage;
  return damage;
}

function actNpcMove(map: GameMap, npc: NpcInstance, speed: number): NpcUpdatePosition | null {
  if (npc.data.type === NpcType.Aggressive || npc.opponents.length > 0) {
    const target = npcChaseTarget(map, npc);
    if (target !== null) return npcStepToward(map, npc, target.row.x, target.row.y);
    if (npc.data.type === NpcType.Passive) return npcWander(map, npc);
  }
  if (npc.actTicks < speed + npc.walkIdleFor) return null;
  return npcWander(map, npc);
}

function npcChaseTarget(map: GameMap, npc: NpcInstance): Character | null {
  const chaseDistance = map.deps.config.npcs.chaseDistance;
  const inChaseRange = (character: Character): boolean =>
    isTargetable(map, character) &&
    distance(npc.x, npc.y, character.row.x, character.row.y) <= chaseDistance;

  if (npc.opponents.length > 0) {
    let best: Character | null = null;
    let bestDamage = -1;
    for (const opponent of npc.opponents) {
      const character = map.characters.get(opponent.playerId);
      if (character === undefined || !inChaseRange(character)) continue;
      if (opponent.damageDealt > bestDamage) {
        best = character;
        bestDamage = opponent.damageDealt;
      }
    }
    return best;
  }

  if (npc.data.type !== NpcType.Aggressive) return null;
  let closest: Character | null = null;
  let closestDistance = Number.MAX_SAFE_INTEGER;
  for (const character of map.characters.values()) {
    if (!inChaseRange(character)) continue;
    const dist = distance(npc.x, npc.y, character.row.x, character.row.y);
    if (dist < closestDistance) {
      closest = character;
      closestDistance = dist;
    }
  }
  return closest;
}

function tryStep(map: GameMap, npc: NpcInstance, direction: number): NpcUpdatePosition | null {
  const target = step(npc.x, npc.y, direction);
  if (!isNpcWalkable(map, target.x, target.y) || isOccupied(map, target.x, target.y)) return null;
  npc.direction = direction;
  npc.x = target.x;
  npc.y = target.y;
  npc.actTicks = 0;
  return npcPosition(npc);
}

function npcStepToward(map: GameMap, npc: NpcInstance, tx: number, ty: number): NpcUpdatePosition | null {
  const dx = npc.x - tx;
  const dy = npc.y - ty;
  const horizontal = dx < 0 ? Direction.Right : Direction.Left;
  const vertical = dy < 0 ? Direction.Down : Direction.Up;
  const primary = Math.abs(dx) > Math.abs(dy) ? horizontal : vertical;
  return (
    tryStep(map, npc, primary) ??
    (primary === vertical ? tryStep(map, npc, horizontal) : null) ??
    tryStep(map, npc, randomRange(Direction.Down, Direction.Right))
  );
}

function npcWander(map: GameMap, npc: NpcInstance): NpcUpdatePosition | null {
  const action = randomRange(1, 10);
  if (action === 10) {
    npc.walkIdleFor = Math.floor((randomRange(1, 4) * 1000) / map.deps.config.world.tickRate);
    return null;
  }
  const direction = action >= 7 ? randomRange(Direction.Down, Direction.Right) : npc.direction;
  npc.direction = direction;
  npc.actTicks = 0;
  npc.walkIdleFor = 0;

  const target = step(npc.x, npc.y, direction);
  if (!isNpcWalkable(map, target.x, target.y) || isOccupied(map, target.x, target.y)) {
    return null;
  }
  npc.x = target.x;
  npc.y = target.y;
  return npcPosition(npc);
}

function npcPosition(npc: NpcInstance): NpcUpdatePosition {
  const position = new NpcUpdatePosition();
  position.npcIndex = npc.index;
  position.coords = npc.coords;
  position.direction = npc.direction;
  return position;
}
