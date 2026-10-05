import { resolve } from 'node:path';
import type { PubData } from './pub-data.ts';

export const PUB_FILES = {
  items: 'dat001.eif',
  npcs: 'dtn001.enf',
  spells: 'dsl001.esf',
  classes: 'dat001.ecf',
  drops: 'dtd001.edf',
  shops: 'dts001.esf',
  skillMasters: 'dsm001.emf',
  inns: 'din001.eid',
  talk: 'ttd001.etf',
} as const;

const CLIENT_PUBS = [
  ['eif', PUB_FILES.items, 'items'],
  ['enf', PUB_FILES.npcs, 'NPCs'],
  ['esf', PUB_FILES.spells, 'spells'],
  ['ecf', PUB_FILES.classes, 'classes'],
] as const;

export class GameDataError extends Error {
  override readonly name = 'GameDataError';
}

export function isMissingFile(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function missingClientPubs(pubs: PubData): string[] {
  return CLIENT_PUBS.filter(([key]) => pubs[key] === null).map(([, file, what]) => `pub/${file} (${what})`);
}

export function gameDataError(dataDir: string, missing: readonly string[], generatePub: boolean): GameDataError {
  const dir = resolve(dataDir);
  const json = generatePub
    ? 'server.generate_pub is on, so the item, NPC, spell and class pubs can also be built from JSON sources ' +
      'in pub/items, pub/npcs, pub/spells and pub/classes.'
    : 'The pubs can also be built from JSON sources with server.generate_pub.';
  return new GameDataError(
    `Endless Online game data is missing or unreadable in ${dir}: ${missing.join(', ')}. ` +
      'teaoh does not include these files: copy them from the pub/ and maps/ folders of an Endless Online ' +
      `client into ${dir}/pub and ${dir}/maps. ${json} ` +
      'See data/pub/README.md, data/maps/README.md and the Game data section of README.md.',
  );
}

export function checkGameData(dataDir: string, pubs: PubData, mapCount: number, generatePub: boolean): void {
  const missing = missingClientPubs(pubs);
  if (mapCount === 0) missing.push('maps/NNNNN.emf (no maps)');
  if (missing.length > 0) throw gameDataError(dataDir, missing, generatePub);
}
