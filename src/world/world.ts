import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMissingFile } from '../data/game-data.ts';
import { log } from '../log.ts';
import { GameMap, type GameMapDeps } from './map/game-map.ts';
import { listMapFiles, type MapFiles } from './map/map-files.ts';

export class World {
  private readonly maps = new Map<number, GameMap>();

  static load(dataDir: string, baseDeps: GameMapDeps): World {
    const world = new World();
    const deps: GameMapDeps = { ...baseDeps, getMap: (id) => world.maps.get(id) };
    const mapsDir = join(dataDir, 'maps');
    let listing: MapFiles;
    try {
      listing = listMapFiles(mapsDir);
    } catch (err) {
      if (!isMissingFile(err)) log.warn({ mapsDir, err: String(err) }, 'maps directory not readable; no maps loaded');
      return world;
    }
    if (listing.skipped.length > 0) {
      log.info({ mapsDir, skipped: listing.skipped }, 'map files skipped (names must be five digits and .emf)');
    }

    let failed = 0;
    for (const [id, file] of [...listing.files].sort(([a], [b]) => a - b)) {
      try {
        const bytes = Uint8Array.from(readFileSync(join(mapsDir, file)));
        world.maps.set(id, new GameMap(id, bytes, deps));
      } catch (err) {
        failed++;
        log.warn({ file, err: String(err) }, 'failed to load map');
      }
    }
    log.info({ loaded: world.maps.size, failed }, 'maps loaded');
    return world;
  }

  static empty(): World {
    return new World();
  }

  getMap(id: number): GameMap | undefined {
    return this.maps.get(id);
  }

  get all(): Iterable<GameMap> {
    return this.maps.values();
  }

  get mapCount(): number {
    return this.maps.size;
  }
}
