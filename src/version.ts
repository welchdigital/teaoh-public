import { readFileSync } from 'node:fs';

interface PackageInfo {
  name: string;
  version: string;
}

function readPackageInfo(): PackageInfo {
  try {
    const raw = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      name: typeof raw.name === 'string' && raw.name !== '' ? raw.name : 'teaoh',
      version: typeof raw.version === 'string' && raw.version !== '' ? raw.version : '0.0.0',
    };
  } catch {
    return { name: 'teaoh', version: '0.0.0' };
  }
}

const info = readPackageInfo();

export const SERVER_NAME = info.name;
export const SERVER_VERSION = info.version;
