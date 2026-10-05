import { EffectUseServerPacket, MapEffect } from 'eolib';
import type { GameMap } from './map/game-map.ts';

export const MIN_QUAKE_MAGNITUDE = 1;
export const MAX_QUAKE_MAGNITUDE = 8;
export const DEFAULT_QUAKE_MAGNITUDE = 1;

export function clampQuakeMagnitude(magnitude: number): number {
  if (!Number.isFinite(magnitude)) return DEFAULT_QUAKE_MAGNITUDE;
  return Math.min(MAX_QUAKE_MAGNITUDE, Math.max(MIN_QUAKE_MAGNITUDE, Math.trunc(magnitude)));
}

export function quakePacket(magnitude: number): EffectUseServerPacket {
  const packet = new EffectUseServerPacket();
  packet.effect = MapEffect.Quake;
  const data = new EffectUseServerPacket.EffectDataQuake();
  data.quakeStrength = clampQuakeMagnitude(magnitude);
  packet.effectData = data;
  return packet;
}

export function quakeMap(map: GameMap, magnitude: number): void {
  if (map.players.size === 0) return;
  map.broadcast(quakePacket(magnitude));
}

export function quakeMaps(maps: Iterable<GameMap>, magnitude: number): number {
  const packet = quakePacket(magnitude);
  let shaken = 0;
  for (const map of maps) {
    if (map.players.size === 0) continue;
    map.broadcast(packet);
    shaken++;
  }
  return shaken;
}
