import { AdminLevel, MapTileSpec, SitState, WalkPlayerServerPacket, WalkReplyServerPacket } from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import { enteredCoord } from '../../../quest/engine.ts';
import { inClientRange, step } from '../../coords.ts';
import { spikeDamage } from '../events/hazards.ts';
import type { GameMap } from '../game-map.ts';
import { getWarp, isInBounds, isOccupied, isWalkable, tileSpec, type MapWarp } from '../tiles.ts';
import { toItemMapInfo } from '../visibility.ts';
import { requestRefresh } from './refresh.ts';

export interface ClientCoords {
  x: number;
  y: number;
}

export const WARP_PENDING_MS = 5000;

export function warpPending(player: Player, now = Date.now()): boolean {
  const session = player.warpSession;
  return session != null && now - session.requestedAt < WARP_PENDING_MS;
}

export function isDoorClosed(map: GameMap, warp: MapWarp, x: number, y: number): boolean {
  if (warp.door <= 0) return false;
  return map.doors.get(`${x},${y}`)?.open !== true;
}

export function walk(
  map: GameMap,
  player: Player,
  character: Character,
  direction: number,
  clientCoords?: ClientCoords,
): void {
  if (character.row.sitting !== SitState.Stand) return;
  const from = { x: character.row.x, y: character.row.y };
  const target = step(from.x, from.y, direction);

  if (!isInBounds(map, target.x, target.y)) return;
  const noClip = character.row.admin_level >= AdminLevel.Spy;
  if (!noClip) {
    if (!isWalkable(map, target.x, target.y)) return;
    if (
      isOccupied(map, target.x, target.y) &&
      (map.ghostTicks.get(character.playerId) ?? 0) > 0
    ) {
      return;
    }
  }
  const warp = getWarp(map, target.x, target.y);
  const doorClosed = warp !== undefined && isDoorClosed(map, warp, target.x, target.y);
  if (doorClosed && !noClip) return;

  character.setCoords(target.x, target.y);
  character.direction = direction;
  map.ghostTicks.set(character.playerId, map.deps.config.world.ghostRate);
  player.warpSuckTicks = map.deps.config.world.warpSuckRate;

  if (
    warp !== undefined &&
    warp.destinationMap !== 0 &&
    !doorClosed &&
    warp.levelRequired <= character.row.level
  ) {
    if (!warpPending(player)) {
      player.requestWarp(warp.destinationMap, warp.x, warp.y, warp.destinationMap === map.id);
    }
    enteredCoord(player);
    return;
  }

  const reply = new WalkReplyServerPacket();
  reply.playerIds = [...map.characters.values()]
    .filter(
      (c) =>
        c.playerId !== character.playerId &&
        c.row.hidden !== 1 &&
        inClientRange(target.x, target.y, c.row.x, c.row.y) &&
        !inClientRange(from.x, from.y, c.row.x, c.row.y),
    )
    .map((c) => c.playerId);
  reply.npcIndexes = [...map.npcs.values()]
    .filter(
      (n) =>
        n.alive &&
        inClientRange(target.x, target.y, n.x, n.y) &&
        !inClientRange(from.x, from.y, n.x, n.y),
    )
    .map((n) => n.index);
  reply.items = [...map.items.values()]
    .filter(
      (i) =>
        inClientRange(target.x, target.y, i.x, i.y) &&
        !inClientRange(from.x, from.y, i.x, i.y),
    )
    .map((i) => toItemMapInfo(i));
  player.bus.send(reply);

  if (character.row.hidden !== 1) {
    const packet = new WalkPlayerServerPacket();
    packet.playerId = character.playerId;
    packet.direction = direction;
    packet.coords = character.coords;
    map.broadcastNear(packet, target.x, target.y, character.playerId);

    const spec = tileSpec(map, target.x, target.y);
    if (spec === MapTileSpec.Spikes || spec === MapTileSpec.HiddenSpikes) {
      spikeDamage(map, player, character);
    }
  }

  enteredCoord(player);

  if (
    clientCoords !== undefined &&
    map.characters.get(character.playerId) === character &&
    (clientCoords.x !== character.row.x || clientCoords.y !== character.row.y)
  ) {
    requestRefresh(map, player, character);
  }
}
