import { Ecf, Eif, Enf, EoReader, Esf, InnFile, ShopFile, SkillMasterFile, TalkFile } from 'eolib';
import type { ShopRecord } from 'eolib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.ts';
import { isMissingFile, PUB_FILES } from './game-data.ts';
import { generatePubs } from './generate-pub.ts';

function loadServerPub<T>(
  dataDir: string,
  filename: string,
  disabled: string,
  deserialize: (r: EoReader) => T,
): T | null {
  const path = join(dataDir, 'pub', filename);
  try {
    const parsed = deserialize(new EoReader(Uint8Array.from(readFileSync(path))));
    log.info({ path }, 'server pub loaded');
    return parsed;
  } catch (err) {
    if (isMissingFile(err)) log.warn({ path }, `optional server pub ${filename} not found; ${disabled}`);
    else log.warn({ path, err: String(err) }, `server pub ${filename} could not be read; ${disabled}`);
    return null;
  }
}

interface PubEntry<T> {
  bytes: Uint8Array;
  parsed: T;
  rid: number[];
  length: number;
}

function loadPub<T>(
  dataDir: string,
  filename: string,
  deserialize: (reader: EoReader) => T,
  count: (parsed: T) => number,
  rid: (parsed: T) => number[],
): PubEntry<T> | null {
  const path = join(dataDir, 'pub', filename);
  try {
    const bytes = Uint8Array.from(readFileSync(path));
    const parsed = deserialize(new EoReader(bytes));
    const entry = { bytes, parsed, rid: rid(parsed), length: count(parsed) };
    log.info({ path, records: entry.length }, 'pub file loaded');
    return entry;
  } catch (err) {
    if (!isMissingFile(err)) log.warn({ path, err: String(err) }, 'pub file could not be read');
    return null;
  }
}

export class PubData {
  readonly eif: PubEntry<Eif> | null;
  readonly enf: PubEntry<Enf> | null;
  readonly esf: PubEntry<Esf> | null;
  readonly ecf: PubEntry<Ecf> | null;
  readonly shops: ShopFile | null;
  readonly skillMasters: SkillMasterFile | null;
  readonly inns: InnFile | null;
  readonly talk: TalkFile | null;

  private constructor(
    eif: PubEntry<Eif> | null,
    enf: PubEntry<Enf> | null,
    esf: PubEntry<Esf> | null,
    ecf: PubEntry<Ecf> | null,
    shops: ShopFile | null = null,
    skillMasters: SkillMasterFile | null = null,
    inns: InnFile | null = null,
    talk: TalkFile | null = null,
  ) {
    this.eif = eif;
    this.enf = enf;
    this.esf = esf;
    this.ecf = ecf;
    this.shops = shops;
    this.skillMasters = skillMasters;
    this.inns = inns;
    this.talk = talk;
  }

  static load(dataDir: string, generate = false): PubData {
    if (generate) generatePubs(dataDir);
    return new PubData(
      loadPub(dataDir, PUB_FILES.items, (r) => Eif.deserialize(r), (p) => p.items.length, (p) => p.rid),
      loadPub(dataDir, PUB_FILES.npcs, (r) => Enf.deserialize(r), (p) => p.npcs.length, (p) => p.rid),
      loadPub(dataDir, PUB_FILES.spells, (r) => Esf.deserialize(r), (p) => p.skills.length, (p) => p.rid),
      loadPub(dataDir, PUB_FILES.classes, (r) => Ecf.deserialize(r), (p) => p.classes.length, (p) => p.rid),
      loadServerPub(dataDir, PUB_FILES.shops, 'shops and crafting are disabled', (r) => ShopFile.deserialize(r)),
      loadServerPub(dataDir, PUB_FILES.skillMasters, 'skill masters teach nothing', (r) =>
        SkillMasterFile.deserialize(r),
      ),
      loadServerPub(dataDir, PUB_FILES.inns, 'inns are disabled and characters respawn at the world spawn', (r) =>
        InnFile.deserialize(r),
      ),
      loadServerPub(dataDir, PUB_FILES.talk, 'NPCs will not talk', (r) => TalkFile.deserialize(r)),
    );
  }

  static empty(): PubData {
    return new PubData(null, null, null, null);
  }

  shopForBehaviorId(behaviorId: number): ShopRecord | undefined {
    return this.shops?.shops.find((s) => s.behaviorId === behaviorId);
  }

  graphicId(itemId: number): number {
    if (itemId <= 0) return 0;
    return this.eif?.parsed.items[itemId - 1]?.spec1 ?? 0;
  }

  itemWeight(itemId: number): number {
    if (itemId <= 0) return 0;
    return this.eif?.parsed.items[itemId - 1]?.weight ?? 0;
  }
}
