import type { Kysely } from 'kysely';
import type { DB } from '../db/schema.ts';
import type { ServerContext } from '../server-context.ts';

export interface MuteEntry {
  id: number;
  characterId: number;
  characterName: string;
  reason: string | null;
  mutedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface AdminState {
  mutes: Map<number, MuteEntry>;
  mutesLoaded: boolean;
  reportCooldowns: Map<number, number>;
}

const states = new WeakMap<object, AdminState>();

export function adminState(server: object): AdminState {
  let state = states.get(server);
  if (state === undefined) {
    state = { mutes: new Map(), mutesLoaded: false, reportCooldowns: new Map() };
    states.set(server, state);
  }
  return state;
}

export function databaseOf(server: Pick<ServerContext, 'db'>): Kysely<DB> | null {
  try {
    const db = (server as { db?: Kysely<DB> }).db;
    return db ?? null;
  } catch {
    return null;
  }
}
