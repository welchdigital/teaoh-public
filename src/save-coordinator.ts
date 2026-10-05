import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import type { MapSavesConfig } from './config.ts';
import { log } from './log.ts';
import type { GameMap } from './world/map/game-map.ts';
import { mapSavePath, snapshotMapState } from './world/map/persistence.ts';

export interface MapSnapshot {
  id: number;
  body: string;
}

let tempCounter = 0;

export function snapshotMaps(maps: Iterable<GameMap>, config: MapSavesConfig): MapSnapshot[] {
  if (!config.enabled || config.dir.trim() === '') return [];
  const snapshots: MapSnapshot[] = [];
  for (const map of maps) {
    try {
      snapshots.push({ id: map.id, body: JSON.stringify(snapshotMapState(map)) });
    } catch (err) {
      log.error({ map: map.id, err: String(err) }, 'failed to snapshot map state');
    }
  }
  return snapshots;
}

export async function writeMapSnapshots(snapshots: readonly MapSnapshot[], dir: string): Promise<number> {
  if (snapshots.length === 0) return 0;
  await mkdir(dir, { recursive: true });
  let saved = 0;
  for (const snapshot of snapshots) {
    const file = mapSavePath(dir, snapshot.id);
    const temp = `${file}.${process.pid}.save${++tempCounter}.tmp`;
    try {
      await writeFile(temp, snapshot.body);
      await rename(temp, file);
      saved++;
    } catch (err) {
      await rm(temp, { force: true }).catch(() => undefined);
      log.error({ map: snapshot.id, err: String(err) }, 'failed to save map state');
    }
  }
  return saved;
}

export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
