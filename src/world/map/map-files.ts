import { SHORT_MAX } from 'eolib';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MAP_FILE_PATTERN = /^(\d{5})\.emf$/i;
const EMF_EXTENSION = /\.emf$/i;

export interface MapFiles {
  files: Map<number, string>;
  skipped: string[];
}

export function mapIdFromFileName(name: string): number | null {
  const match = MAP_FILE_PATTERN.exec(name);
  if (match === null) return null;
  const id = Number(match[1]);
  return id > 0 && id < SHORT_MAX ? id : null;
}

export function listMapFiles(mapsDir: string): MapFiles {
  const files = new Map<number, string>();
  const skipped: string[] = [];
  const names = readdirSync(mapsDir, { withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && EMF_EXTENSION.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const id = mapIdFromFileName(name);
    const existing = id === null ? undefined : files.get(id);
    if (id === null) {
      skipped.push(name);
    } else if (existing === undefined) {
      files.set(id, name);
    } else if (name.endsWith('.emf') && !existing.endsWith('.emf')) {
      skipped.push(existing);
      files.set(id, name);
    } else {
      skipped.push(name);
    }
  }
  return { files, skipped };
}

export function mapFilePath(mapsDir: string, id: number): string {
  const canonical = join(mapsDir, `${String(id).padStart(5, '0')}.emf`);
  if (existsSync(canonical)) return canonical;
  try {
    const name = listMapFiles(mapsDir).files.get(id);
    return name === undefined ? canonical : join(mapsDir, name);
  } catch {
    return canonical;
  }
}
