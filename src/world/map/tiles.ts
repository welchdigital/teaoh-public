import { MapTileSpec, type Emf } from 'eolib';
import type { GameMap } from './game-map.ts';

export interface MapWarp {
  readonly destinationMap: number;
  readonly x: number;
  readonly y: number;
  readonly levelRequired: number;
  readonly door: number;
}

export interface TileIndex {
  readonly stride: number;
  readonly rows: number;
  readonly specs: (number | undefined)[];
  readonly warps: (MapWarp | undefined)[];
  readonly jukeboxes: { x: number; y: number }[];
  readonly hasTimedSpikes: boolean;
}

export const WALL_SPECS: ReadonlySet<number> = new Set<number>([
  MapTileSpec.Wall,
  MapTileSpec.ChairDown,
  MapTileSpec.ChairLeft,
  MapTileSpec.ChairRight,
  MapTileSpec.ChairUp,
  MapTileSpec.ChairDownRight,
  MapTileSpec.ChairUpLeft,
  MapTileSpec.ChairAll,
  MapTileSpec.Chest,
  MapTileSpec.BankVault,
  MapTileSpec.Edge,
  MapTileSpec.Board1,
  MapTileSpec.Board2,
  MapTileSpec.Board3,
  MapTileSpec.Board4,
  MapTileSpec.Board5,
  MapTileSpec.Board6,
  MapTileSpec.Board7,
  MapTileSpec.Board8,
  MapTileSpec.Jukebox,
]);

export function buildTileIndex(emf: Emf): TileIndex {
  let maxX = emf.width;
  let maxY = emf.height;
  for (const row of [...emf.tileSpecRows, ...emf.warpRows]) {
    maxY = Math.max(maxY, row.y);
    for (const tile of row.tiles) maxX = Math.max(maxX, tile.x);
  }
  const stride = maxX + 1;
  const rows = maxY + 1;
  const jukeboxes: { x: number; y: number }[] = [];
  let hasTimedSpikes = false;
  for (const row of emf.tileSpecRows) {
    for (const tile of row.tiles) {
      if (tile.tileSpec === MapTileSpec.Jukebox) jukeboxes.push({ x: tile.x, y: row.y });
      if (tile.tileSpec === MapTileSpec.TimedSpikes) hasTimedSpikes = true;
    }
  }
  const index: TileIndex = {
    stride,
    rows,
    specs: new Array<number | undefined>(stride * rows).fill(undefined),
    warps: new Array<MapWarp | undefined>(stride * rows).fill(undefined),
    jukeboxes,
    hasTimedSpikes,
  };

  const specRows = new Set<number>();
  for (const row of emf.tileSpecRows) {
    if (specRows.has(row.y)) continue;
    specRows.add(row.y);
    for (const tile of row.tiles) {
      const cell = cellOf(index, tile.x, row.y);
      if (cell >= 0 && index.specs[cell] === undefined) index.specs[cell] = tile.tileSpec;
    }
  }

  const warpRows = new Set<number>();
  for (const row of emf.warpRows) {
    if (warpRows.has(row.y)) continue;
    warpRows.add(row.y);
    for (const tile of row.tiles) {
      const cell = cellOf(index, tile.x, row.y);
      if (cell >= 0 && index.warps[cell] === undefined) {
        index.warps[cell] = {
          destinationMap: tile.warp.destinationMap,
          x: tile.warp.destinationCoords.x,
          y: tile.warp.destinationCoords.y,
          levelRequired: tile.warp.levelRequired,
          door: tile.warp.door,
        };
      }
    }
  }
  return index;
}

function cellOf(index: TileIndex, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= index.stride || y >= index.rows) return -1;
  return y * index.stride + x;
}

export function tileSpec(map: GameMap, x: number, y: number): number | undefined {
  const cell = cellOf(map.tiles, x, y);
  return cell < 0 ? undefined : map.tiles.specs[cell];
}

export function getWarp(map: GameMap, x: number, y: number): MapWarp | undefined {
  const cell = cellOf(map.tiles, x, y);
  return cell < 0 ? undefined : map.tiles.warps[cell];
}

export function isInBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= map.emf.width && y <= map.emf.height;
}

export function isWalkable(map: GameMap, x: number, y: number): boolean {
  if (!isInBounds(map, x, y)) return false;
  const spec = tileSpec(map, x, y);
  return spec === undefined || !WALL_SPECS.has(spec);
}

export function isNpcWalkable(map: GameMap, x: number, y: number): boolean {
  return (
    isWalkable(map, x, y) &&
    tileSpec(map, x, y) !== MapTileSpec.NpcBoundary &&
    getWarp(map, x, y) === undefined
  );
}

export function isOccupied(map: GameMap, x: number, y: number): boolean {
  for (const character of map.characters.values()) {
    if (character.row.hidden !== 1 && character.row.x === x && character.row.y === y) return true;
  }
  for (const npc of map.npcs.values()) {
    if (npc.alive && npc.x === x && npc.y === y) return true;
  }
  return false;
}
