import {
  AdminLevel,
  ChairCloseServerPacket,
  ChairPlayerServerPacket,
  ChairReplyServerPacket,
  Direction,
  MapTileSpec,
  SitCloseServerPacket,
  SitPlayerServerPacket,
  SitRemoveServerPacket,
  SitReplyServerPacket,
  SitState,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Player } from '../../../player/player.ts';
import { distance, step } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';
import { getWarp, isInBounds, isOccupied, isWalkable, tileSpec } from '../tiles.ts';
import { isDoorClosed } from './walk.ts';

function chairDirection(spec: number, fromX: number, fromY: number, cx: number, cy: number): number | null {
  switch (spec) {
    case MapTileSpec.ChairDown:
      return cy === fromY - 1 ? Direction.Down : null;
    case MapTileSpec.ChairUp:
      return cy === fromY + 1 ? Direction.Up : null;
    case MapTileSpec.ChairRight:
      return cx === fromX - 1 ? Direction.Right : null;
    case MapTileSpec.ChairLeft:
      return cx === fromX + 1 ? Direction.Left : null;
    case MapTileSpec.ChairUpLeft:
      if (cy === fromY + 1) return Direction.Up;
      if (cx === fromX + 1) return Direction.Left;
      return null;
    case MapTileSpec.ChairDownRight:
      if (cy === fromY - 1) return Direction.Down;
      if (cx === fromX - 1) return Direction.Right;
      return null;
    case MapTileSpec.ChairAll:
      if (cy === fromY - 1) return Direction.Down;
      if (cy === fromY + 1) return Direction.Up;
      if (cx === fromX - 1) return Direction.Right;
      if (cx === fromX + 1) return Direction.Left;
      return null;
    default:
      return null;
  }
}

export function sitChair(map: GameMap, player: Player, character: Character, x: number, y: number): void {
  if (character.row.sitting !== SitState.Stand) return;
  if (isOccupied(map, x, y)) return;
  if (distance(character.row.x, character.row.y, x, y) > 1) return;
  const spec = tileSpec(map, x, y);
  if (spec === undefined) return;
  const direction = chairDirection(spec, character.row.x, character.row.y, x, y);
  if (direction === null) return;

  character.setCoords(x, y);
  character.direction = direction;
  character.row.sitting = SitState.Chair;

  const reply = new ChairReplyServerPacket();
  reply.playerId = character.playerId;
  reply.coords = character.coords;
  reply.direction = direction;
  player.bus.send(reply);

  if (character.row.hidden !== 1) {
    const broadcast = new ChairPlayerServerPacket();
    broadcast.playerId = character.playerId;
    broadcast.coords = character.coords;
    broadcast.direction = direction;
    map.broadcastNear(broadcast, x, y, character.playerId);
  }
}

export function sit(map: GameMap, player: Player, character: Character): void {
  if (character.row.sitting !== SitState.Stand) return;
  character.row.sitting = SitState.Floor;

  const reply = new SitReplyServerPacket();
  reply.playerId = character.playerId;
  reply.coords = character.coords;
  reply.direction = character.direction;
  player.bus.send(reply);

  if (character.row.hidden !== 1) {
    const broadcast = new SitPlayerServerPacket();
    broadcast.playerId = character.playerId;
    broadcast.coords = character.coords;
    broadcast.direction = character.direction;
    map.broadcastNear(broadcast, character.row.x, character.row.y, character.playerId);
  }
}

export function stand(map: GameMap, player: Player, character: Character): void {
  if (character.row.sitting === SitState.Chair) {
    standFromChair(map, player, character);
    return;
  }
  if (character.row.sitting !== SitState.Floor) return;
  character.row.sitting = SitState.Stand;

  const reply = new SitCloseServerPacket();
  reply.playerId = character.playerId;
  reply.coords = character.coords;
  player.bus.send(reply);

  if (character.row.hidden !== 1) {
    const broadcast = new SitRemoveServerPacket();
    broadcast.playerId = character.playerId;
    broadcast.coords = character.coords;
    map.broadcastNear(broadcast, character.row.x, character.row.y, character.playerId);
  }
}

function canStandOn(map: GameMap, character: Character, x: number, y: number): boolean {
  if (!isInBounds(map, x, y)) return false;
  if (character.row.admin_level >= AdminLevel.Spy) return true;
  if (!isWalkable(map, x, y) || isOccupied(map, x, y)) return false;
  const warp = getWarp(map, x, y);
  return warp === undefined || !isDoorClosed(map, warp, x, y);
}

export function standFromChair(map: GameMap, player: Player, character: Character): void {
  if (character.row.sitting !== SitState.Chair) return;
  const stepped = step(character.row.x, character.row.y, character.direction);
  if (!canStandOn(map, character, stepped.x, stepped.y)) return;
  character.setCoords(stepped.x, stepped.y);
  character.row.sitting = SitState.Stand;

  const close = new ChairCloseServerPacket();
  close.playerId = character.playerId;
  close.coords = character.coords;
  player.bus.send(close);

  if (character.row.hidden !== 1) {
    const remove = new SitRemoveServerPacket();
    remove.playerId = character.playerId;
    remove.coords = character.coords;
    map.broadcastNear(remove, character.row.x, character.row.y, character.playerId);
  }
}
