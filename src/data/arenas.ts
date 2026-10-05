import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.ts';

export interface ArenaSpawn {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface Arena {
  map: number;
  rate: number;
  block: number;
  spawns: ArenaSpawn[];
}

const DURATION_UNITS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };

function parseSeconds(value: string): number {
  let total = 0;
  let matched = false;
  for (const match of value.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?/g)) {
    matched = true;
    total += Number.parseFloat(match[1]!) * (DURATION_UNITS[match[2] ?? 's'] ?? 1);
  }
  return matched ? total : Number.NaN;
}

function parseBool(value: string): boolean {
  const lower = value.trim().toLowerCase();
  const leadingInt = Number.parseInt(lower, 10);
  return (
    lower === 'yes' ||
    lower === 'true' ||
    lower === 'enabled' ||
    (Number.isInteger(leadingInt) && leadingInt !== 0)
  );
}

export function parseArenasIni(text: string, warn: (message: string) => void = () => {}): Arena[] {
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values.set(trimmed.slice(0, eq).trimEnd(), trimmed.slice(eq + 1).trimStart());
  }

  const mapIds = new Set<number>();
  for (const key of values.keys()) {
    const dot = key.indexOf('.');
    if (dot <= 0) continue;
    const id = Number(key.slice(0, dot));
    if (Number.isInteger(id) && id > 0) mapIds.add(id);
  }

  const arenas: Arena[] = [];
  for (const map of [...mapIds].sort((a, b) => a - b)) {
    if (!parseBool(values.get(`${map}.enabled`) ?? '')) continue;
    const numbers = (values.get(`${map}.spawns`) ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => Number.parseInt(part, 10));
    if (numbers.length % 4 !== 0 || numbers.some((n) => !Number.isInteger(n) || n < 0)) {
      warn(`invalid arena spawn data for map ${map}`);
      continue;
    }
    const spawns: ArenaSpawn[] = [];
    for (let i = 0; i < numbers.length; i += 4) {
      spawns.push({
        from: { x: numbers[i]!, y: numbers[i + 1]! },
        to: { x: numbers[i + 2]!, y: numbers[i + 3]! },
      });
    }
    const rate = Math.round(parseSeconds(values.get(`${map}.time`) ?? ''));
    const block = Number.parseInt(values.get(`${map}.block`) ?? '', 10);
    if (!Number.isFinite(rate) || rate < 1) {
      warn(`invalid arena time for map ${map}`);
      continue;
    }
    arenas.push({
      map,
      rate,
      block: Number.isInteger(block) && block > 0 ? block : 1,
      spawns,
    });
  }
  return arenas;
}

export class ArenaTable {
  private readonly arenas = new Map<number, Arena>();

  constructor(arenas: Arena[] = []) {
    for (const arena of arenas) this.arenas.set(arena.map, arena);
  }

  static load(dataDir: string): ArenaTable {
    const path = join(dataDir, 'arenas.ini');
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ path, err: String(err) }, 'arenas not loaded');
      }
      return new ArenaTable();
    }
    const table = new ArenaTable(
      parseArenasIni(text, (message) => log.warn({ path }, message)),
    );
    log.info({ path, arenas: table.arenas.size }, 'arenas loaded');
    return table;
  }

  forMap(mapId: number): Arena | undefined {
    return this.arenas.get(mapId);
  }
}
