import {
  EffectAdminServerPacket,
  EffectReportServerPacket,
  EffectSpecServerPacket,
  EffectTargetOtherServerPacket,
  EffectUseServerPacket,
  MapDamageType,
  MapDrainDamageOther,
  MapEffect,
  MapTileSpec,
  MapTimedEffect,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import { inClientRange } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';
import { randomRange } from '../math.ts';
import { broadcastPartyHp } from '../party-hp.ts';
import { tileSpec } from '../tiles.ts';

export function hpPercentage(character: Character): number {
  return Math.min(100, Math.floor((character.row.hp / Math.max(1, character.maxHp)) * 100));
}

export function spikeDamage(map: GameMap, player: Player, character: Character): void {
  const damage = Math.max(
    0,
    Math.min(Math.floor(character.maxHp * map.deps.config.world.spikeDamage), character.row.hp),
  );
  character.row.hp -= damage;
  const died = character.row.hp === 0;

  const others = new EffectAdminServerPacket();
  others.playerId = character.playerId;
  others.hpPercentage = hpPercentage(character);
  others.died = died;
  others.damage = damage;
  map.broadcastNear(others, character.row.x, character.row.y, character.playerId);

  const self = new EffectSpecServerPacket();
  self.mapDamageType = MapDamageType.Spikes;
  const data = new EffectSpecServerPacket.MapDamageTypeDataSpikes();
  data.hpDamage = damage;
  data.hp = character.row.hp;
  data.maxHp = character.maxHp;
  self.mapDamageTypeData = data;
  player.bus.send(self);

  broadcastPartyHp(map, character);
  if (died) player.die();
}

export function timedSpikes(map: GameMap): void {
  if (!map.tiles.hasTimedSpikes || map.characters.size === 0) return;
  const damaged: [Player, Character][] = [];
  const report = new EffectReportServerPacket();
  for (const [playerId, character] of map.characters) {
    const player = map.players.get(playerId);
    if (player === undefined) continue;
    if (
      character.row.hidden !== 1 &&
      tileSpec(map, character.row.x, character.row.y) === MapTileSpec.TimedSpikes
    ) {
      damaged.push([player, character]);
    } else {
      player.bus.send(report);
    }
  }
  for (const [player, character] of damaged) {
    if (map.characters.get(character.playerId) === character) spikeDamage(map, player, character);
  }
}

export function timedDrain(map: GameMap): void {
  const effect = map.emf.timedEffect;
  if (effect === MapTimedEffect.HpDrain) timedDrainHp(map);
  if (effect === MapTimedEffect.TpDrain) timedDrainTp(map);
}

function timedDrainHp(map: GameMap): void {
  const rate = map.deps.config.world.drainHpDamage;
  const damages = new Map<number, number>();
  for (const [playerId, character] of map.characters) {
    if (character.row.hidden === 1) {
      damages.set(playerId, 0);
      continue;
    }
    const damage = Math.max(
      0,
      Math.min(Math.floor(character.maxHp * rate), character.row.hp - 1),
    );
    character.row.hp -= damage;
    damages.set(playerId, damage);
  }

  for (const [playerId, character] of map.characters) {
    const player = map.players.get(playerId);
    if (player === undefined) continue;
    const damage = damages.get(playerId) ?? 0;
    if (damage > 0) broadcastPartyHp(map, character);

    const packet = new EffectTargetOtherServerPacket();
    packet.damage = damage;
    packet.hp = character.row.hp;
    packet.maxHp = character.maxHp;
    packet.others = [];
    for (const [otherId, other] of map.characters) {
      if (otherId === playerId || other.row.hidden === 1) continue;
      if (!inClientRange(character.row.x, character.row.y, other.row.x, other.row.y)) continue;
      const otherDamage = damages.get(otherId) ?? 0;
      if (otherDamage <= 0) continue;
      const entry = new MapDrainDamageOther();
      entry.playerId = otherId;
      entry.hpPercentage = hpPercentage(other);
      entry.damage = otherDamage;
      packet.others.push(entry);
    }
    player.bus.send(packet);
  }
}

function timedDrainTp(map: GameMap): void {
  const rate = map.deps.config.world.drainTpDamage;
  for (const [playerId, character] of map.characters) {
    if (character.row.tp <= 0 || character.row.hidden === 1) continue;
    const damage = Math.max(
      0,
      Math.min(Math.floor(character.maxTp * rate), character.row.tp - 1),
    );
    character.row.tp -= damage;
    const player = map.players.get(playerId);
    if (player === undefined) continue;
    const packet = new EffectSpecServerPacket();
    packet.mapDamageType = MapDamageType.TpDrain;
    const data = new EffectSpecServerPacket.MapDamageTypeDataTpDrain();
    data.tpDamage = damage;
    data.tp = character.row.tp;
    data.maxTp = character.maxTp;
    packet.mapDamageTypeData = data;
    player.bus.send(packet);
  }
}

export function timedQuake(map: GameMap): void {
  const effect = map.emf.timedEffect;
  const index =
    effect === MapTimedEffect.Quake1
      ? 0
      : effect === MapTimedEffect.Quake2
        ? 1
        : effect === MapTimedEffect.Quake3
          ? 2
          : effect === MapTimedEffect.Quake4
            ? 3
            : -1;
  if (index < 0) return;
  const config = map.deps.config.world.quakes[index];
  if (config === undefined) return;

  if (map.quakeRate === null) {
    map.quakeRate = randomRange(config.minTicks, config.maxTicks);
  }
  if (map.quakeStrength === null) {
    map.quakeStrength = randomRange(config.minStrength, config.maxStrength);
  }

  map.quakeTicks++;
  if (map.quakeTicks < map.quakeRate) return;

  if (map.players.size > 0) {
    const packet = new EffectUseServerPacket();
    packet.effect = MapEffect.Quake;
    const data = new EffectUseServerPacket.EffectDataQuake();
    data.quakeStrength = map.quakeStrength;
    packet.effectData = data;
    map.broadcast(packet);
  }

  map.quakeTicks = 0;
  map.quakeRate = null;
  map.quakeStrength = null;
}
