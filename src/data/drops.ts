import { DropFile, EoReader, SHORT_MAX, THREE_MAX } from 'eolib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { log } from '../log.ts';
import { isMissingFile, PUB_FILES } from './game-data.ts';

export interface Drop {
  itemId: number;
  min: number;
  max: number;
  rate: number;
}

export interface RawDrop {
  itemId: number;
  min: number;
  max: number;
  rate: number;
}

const RATE_SCALE = 64000;
const PERCENT_TO_RATE = RATE_SCALE / 100;
export const MAX_DROP_ITEM_ID = SHORT_MAX - 1;
export const MAX_DROP_AMOUNT = THREE_MAX - 1;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function validateDrop(raw: RawDrop, itemCount?: number): Drop | string {
  const { itemId, min, max, rate } = raw;
  if (!Number.isInteger(itemId) || itemId <= 0 || itemId > MAX_DROP_ITEM_ID) {
    return `invalid item id ${itemId}`;
  }
  if (itemCount !== undefined && itemId > itemCount) {
    return `item id ${itemId} is not in the item pub (${itemCount} items)`;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 'amounts must be numbers';
  if (!Number.isFinite(rate)) return 'rate must be a number';
  const low = Math.trunc(Math.min(min, max));
  const high = Math.trunc(Math.max(min, max));
  if (high < 1) return `amount ${high} is below 1`;
  if (rate <= 0) return 'rate is 0';
  return {
    itemId,
    min: clamp(low, 1, MAX_DROP_AMOUNT),
    max: clamp(high, 1, MAX_DROP_AMOUNT),
    rate: Math.round(clamp(rate, 0, RATE_SCALE)),
  };
}

class DropValidator {
  private readonly skipped: string[] = [];
  private readonly source: string;
  private readonly itemCount: number | undefined;

  constructor(source: string, itemCount: number | undefined) {
    this.source = source;
    this.itemCount = itemCount;
  }

  check(raw: RawDrop, label: string): Drop | null {
    const result = validateDrop(raw, this.itemCount);
    if (typeof result === 'string') {
      this.skipped.push(`${label}: ${result}`);
      return null;
    }
    return result;
  }

  skip(reason: string): void {
    this.skipped.push(reason);
  }

  report(): void {
    if (this.skipped.length === 0) return;
    log.warn(
      { path: this.source, skipped: this.skipped.length, examples: this.skipped.slice(0, 10) },
      'invalid drop entries skipped',
    );
  }
}

export function parseGlobalDrops(text: string, itemCount?: number, source = 'global_drops.toml'): Drop[] {
  const parsed = parseToml(text) as { drops?: unknown };
  if (parsed.drops === undefined) return [];
  if (!Array.isArray(parsed.drops)) throw new Error('drops: expected an array of tables');
  const validator = new DropValidator(source, itemCount);
  const drops: Drop[] = [];
  parsed.drops.forEach((entry: unknown, i) => {
    if (typeof entry !== 'object' || entry === null) {
      validator.skip(`drops[${i}]: expected a table`);
      return;
    }
    const record = entry as Record<string, unknown>;
    const number = (key: string): number => {
      const value = record[key];
      return typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string'
        ? Number(value)
        : Number.NaN;
    };
    const percent = number('rate');
    const drop = validator.check(
      {
        itemId: number('item_id'),
        min: number('min_amount'),
        max: number('max_amount'),
        rate: Number.isFinite(percent) ? clamp(percent, 0, 100) * PERCENT_TO_RATE : percent,
      },
      `drops[${i}]`,
    );
    if (drop !== null) drops.push(drop);
  });
  validator.report();
  return drops;
}

export function parseDropsIni(text: string, itemCount?: number, source = 'drops.ini'): Map<number, Drop[]> {
  const tables = new Map<number, Drop[]>();
  const validator = new DropValidator(source, itemCount);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const npcId = Number.parseInt(trimmed.slice(0, eq).trim(), 10);
    if (!Number.isInteger(npcId)) continue;
    const values = trimmed
      .slice(eq + 1)
      .split(',')
      .map((v) => Number(v.trim()));
    const drops: Drop[] = [];
    for (let i = 0; i + 3 < values.length; i += 4) {
      const percent = values[i + 3]!;
      const drop = validator.check(
        {
          itemId: values[i]!,
          min: values[i + 1]!,
          max: values[i + 2]!,
          rate: Number.isFinite(percent) ? clamp(percent, 0, 100) * PERCENT_TO_RATE : percent,
        },
        `npc ${npcId} entry ${i / 4 + 1}`,
      );
      if (drop !== null) drops.push(drop);
    }
    if (drops.length > 0) tables.set(npcId, drops);
  }
  validator.report();
  return tables;
}

export class DropTables {
  private readonly drops = new Map<number, Drop[]>();
  private globalDrops: Drop[] = [];

  static load(dataDir: string, itemCount?: number): DropTables {
    const tables = DropTables.loadNpcDrops(dataDir, itemCount);
    const globalPath = join(dataDir, 'global_drops.toml');
    let text: string | null = null;
    try {
      text = readFileSync(globalPath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.warn({ path: globalPath, err: String(err) }, 'global drops not loaded');
      }
    }
    if (text !== null) {
      try {
        tables.globalDrops = parseGlobalDrops(text, itemCount, globalPath);
        log.info({ path: globalPath, drops: tables.globalDrops.length }, 'global drops loaded');
      } catch (err) {
        log.warn({ path: globalPath, err: String(err) }, 'global drops not loaded');
      }
    }
    return tables;
  }

  private static loadNpcDrops(dataDir: string, itemCount: number | undefined): DropTables {
    const tables = new DropTables();
    const pubPath = join(dataDir, 'pub', PUB_FILES.drops);
    let problem: string;
    try {
      const file = DropFile.deserialize(
        new EoReader(Uint8Array.from(readFileSync(pubPath))),
      );
      const validator = new DropValidator(pubPath, itemCount);
      for (const npc of file.npcs) {
        const drops: Drop[] = [];
        npc.drops.forEach((d, i) => {
          const drop = validator.check(
            { itemId: d.itemId, min: d.minAmount, max: d.maxAmount, rate: d.rate },
            `npc ${npc.npcId} entry ${i + 1}`,
          );
          if (drop !== null) drops.push(drop);
        });
        if (drops.length > 0) tables.drops.set(npc.npcId, drops);
      }
      validator.report();
      log.info({ path: pubPath, npcs: tables.drops.size }, 'drop tables loaded');
      return tables;
    } catch (err) {
      problem = isMissingFile(err)
        ? `optional server pub ${PUB_FILES.drops} not found`
        : `server pub ${PUB_FILES.drops} could not be read (${String(err)})`;
    }

    const iniPath = join(dataDir, 'drops.ini');
    try {
      const parsed = parseDropsIni(readFileSync(iniPath, 'utf8'), itemCount, iniPath);
      for (const [npcId, drops] of parsed) tables.drops.set(npcId, drops);
      log.warn({ path: pubPath, fallback: iniPath, npcs: tables.drops.size }, `${problem}; using drops.ini`);
    } catch (err) {
      const detail = isMissingFile(err) ? {} : { err: String(err) };
      log.warn(
        { path: pubPath, fallback: iniPath, ...detail },
        `${problem} and drops.ini is unusable; NPCs only drop global drops`,
      );
    }
    return tables;
  }

  static empty(): DropTables {
    return new DropTables();
  }

  get global(): readonly Drop[] {
    return this.globalDrops;
  }

  setGlobalDrops(drops: Drop[]): void {
    this.globalDrops = [...drops];
  }

  setNpcDrops(npcId: number, drops: Drop[]): void {
    this.drops.set(npcId, [...drops]);
  }

  candidates(npcId: number): Drop[] {
    return [...this.globalDrops, ...(this.drops.get(npcId) ?? [])].sort(
      (a, b) => a.rate - b.rate,
    );
  }

  roll(npcId: number): { itemId: number; amount: number } | null {
    for (const drop of this.candidates(npcId)) {
      if (drop.rate <= 0) continue;
      if (Math.floor(Math.random() * RATE_SCALE) < drop.rate) {
        const amount = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
        if (amount <= 0) continue;
        return { itemId: drop.itemId, amount: Math.min(amount, MAX_DROP_AMOUNT) };
      }
    }
    return null;
  }
}
