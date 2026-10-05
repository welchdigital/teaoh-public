import type { Kysely } from 'kysely';
import { toDbTimestamp, toUtcDate, type DB } from '../db/schema.ts';
import { log } from '../log.ts';
import type { ServerContext } from '../server-context.ts';
import { adminState, databaseOf, type MuteEntry } from './state.ts';

export interface MuteRecord {
  id: number;
  characterId: number;
  characterName: string;
  reason: string | null;
  mutedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
  active: boolean;
}

type MuteRow = {
  id: number;
  character_id: number;
  character_name: string;
  reason: string | null;
  muted_by: string | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
};

function toRecord(row: MuteRow, now: Date): MuteRecord {
  const expiresAt = row.expires_at === null ? null : toUtcDate(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : toUtcDate(row.revoked_at);
  return {
    id: row.id,
    characterId: row.character_id,
    characterName: row.character_name,
    reason: row.reason,
    mutedBy: row.muted_by,
    createdAt: toUtcDate(row.created_at),
    expiresAt,
    revokedAt,
    revokedBy: row.revoked_by,
    active: revokedAt === null && (expiresAt === null || expiresAt.getTime() > now.getTime()),
  };
}

export function activeMute(
  server: object,
  characterId: number,
  now: number = Date.now(),
): MuteEntry | null {
  const mutes = adminState(server).mutes;
  const entry = mutes.get(characterId);
  if (entry === undefined) return null;
  if (entry.expiresAt !== null && entry.expiresAt.getTime() <= now) {
    mutes.delete(characterId);
    return null;
  }
  return entry;
}

export async function loadMutes(server: Pick<ServerContext, 'db'>, now: Date = new Date()): Promise<number> {
  const db = databaseOf(server);
  const state = adminState(server);
  if (db === null) return 0;
  const rows = await db
    .selectFrom('mutes')
    .selectAll()
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', toDbTimestamp(now))]))
    .orderBy('id', 'asc')
    .execute();
  state.mutes.clear();
  for (const row of rows) {
    const record = toRecord(row, now);
    if (!record.active) continue;
    state.mutes.set(record.characterId, {
      id: record.id,
      characterId: record.characterId,
      characterName: record.characterName,
      reason: record.reason,
      mutedBy: record.mutedBy,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
  }
  state.mutesLoaded = true;
  return state.mutes.size;
}

export interface MuteOptions {
  characterId: number;
  characterName: string;
  durationMs: number | null;
  reason?: string | null | undefined;
  mutedBy: string;
}

export function applyMute(server: Pick<ServerContext, 'db'>, options: MuteOptions): { entry: MuteEntry; saved: Promise<void> } {
  const now = new Date();
  const expiresAt = options.durationMs === null ? null : new Date(now.getTime() + options.durationMs);
  const entry: MuteEntry = {
    id: 0,
    characterId: options.characterId,
    characterName: options.characterName,
    reason: options.reason ?? null,
    mutedBy: options.mutedBy,
    createdAt: now,
    expiresAt,
  };
  const db = databaseOf(server);
  if (db === null) {
    adminState(server).mutes.set(options.characterId, entry);
    return { entry, saved: Promise.resolve() };
  }
  const saved = persistMute(db, entry, options.mutedBy).then((id) => {
    entry.id = id;
    adminState(server).mutes.set(options.characterId, entry);
  });
  return { entry, saved };
}

async function persistMute(db: Kysely<DB>, entry: MuteEntry, by: string): Promise<number> {
  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('mutes')
      .set({ revoked_at: toDbTimestamp(entry.createdAt), revoked_by: by })
      .where('character_id', '=', entry.characterId)
      .where('revoked_at', 'is', null)
      .execute();
    const inserted = await trx
      .insertInto('mutes')
      .values({
        character_id: entry.characterId,
        character_name: entry.characterName,
        reason: entry.reason,
        muted_by: entry.mutedBy,
        created_at: toDbTimestamp(entry.createdAt),
        expires_at: entry.expiresAt === null ? null : toDbTimestamp(entry.expiresAt),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return inserted.id;
  });
}

export function clearMute(
  server: Pick<ServerContext, 'db'>,
  characterId: number,
  revokedBy: string,
): { wasMuted: boolean; saved: Promise<number> } {
  const wasMuted = activeMute(server, characterId) !== null;
  adminState(server).mutes.delete(characterId);
  const db = databaseOf(server);
  const saved =
    db === null
      ? Promise.resolve(0)
      : db
          .updateTable('mutes')
          .set({ revoked_at: toDbTimestamp(new Date()), revoked_by: revokedBy })
          .where('character_id', '=', characterId)
          .where('revoked_at', 'is', null)
          .executeTakeFirst()
          .then((result) => Number(result.numUpdatedRows));
  return { wasMuted, saved };
}

export interface ListMutesOptions {
  active?: boolean | undefined;
  characterId?: number | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

function filtered(db: Kysely<DB>, options: ListMutesOptions, now: Date) {
  const nowValue = toDbTimestamp(now);
  let query = db.selectFrom('mutes');
  if (options.characterId !== undefined) query = query.where('character_id', '=', options.characterId);
  if (options.active === true) {
    query = query
      .where('revoked_at', 'is', null)
      .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', nowValue)]));
  } else if (options.active === false) {
    query = query.where((eb) =>
      eb.or([
        eb('revoked_at', 'is not', null),
        eb.and([eb('expires_at', 'is not', null), eb('expires_at', '<=', nowValue)]),
      ]),
    );
  }
  return query;
}

export async function listMutes(
  db: Kysely<DB>,
  options: ListMutesOptions = {},
  now: Date = new Date(),
): Promise<MuteRecord[]> {
  const rows = await filtered(db, options, now)
    .selectAll()
    .orderBy('id', 'desc')
    .limit(Math.max(1, Math.min(500, Math.floor(options.limit ?? 50))))
    .offset(Math.max(0, Math.floor(options.offset ?? 0)))
    .execute();
  return rows.map((row) => toRecord(row, now));
}

export async function countMutes(
  db: Kysely<DB>,
  options: ListMutesOptions = {},
  now: Date = new Date(),
): Promise<number> {
  const row = await filtered(db, options, now)
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export function logMuteFailure(err: unknown, characterName: string): void {
  log.error({ cat: 'admin', character: characterName, err: String(err) }, 'failed to persist mute');
}
