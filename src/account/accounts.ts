import {
  AdminLevel,
  CharacterSelectionListEntry,
  EquipmentCharacterSelect,
  Gender,
} from 'eolib';
import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { PubData } from '../data/pub-data.ts';
import { toDbTimestamp, toUtcDate, type DB } from '../db/schema.ts';

export const MAX_ACCOUNT_NAME_LENGTH = 16;
export const MAX_ACCOUNT_FIELD_LENGTH = 64;
export const MAX_HDID_LENGTH = 64;

export function validateAccountName(name: string): boolean {
  return (
    name.trim().length > 0 &&
    name.length <= MAX_ACCOUNT_NAME_LENGTH &&
    /^[a-z0-9 ]+$/.test(name)
  );
}

export function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > MAX_ACCOUNT_FIELD_LENGTH) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : null;
}

export function normalizeHdid(hdid: string): string | null {
  const trimmed = hdid.trim();
  if (!/^[\x21-\x7e]*$/.test(trimmed)) return null;
  return trimmed.slice(0, MAX_HDID_LENGTH);
}

export function validAccountField(value: string): boolean {
  return value.length <= MAX_ACCOUNT_FIELD_LENGTH;
}

export function validPasswordLength(password: string, limits: { minPasswordLength: number; maxPasswordLength: number }): boolean {
  return password.length >= limits.minPasswordLength && password.length <= limits.maxPasswordLength;
}

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return [...email]
    .map((c, i) => (i === 0 || i >= at - 1 ? c : '*'))
    .join('');
}

export async function accountExists(db: Kysely<DB>, name: string): Promise<boolean> {
  const row = await db
    .selectFrom('accounts')
    .select('id')
    .where('name', '=', name)
    .executeTakeFirst();
  return row !== undefined;
}

export interface PasswordRow {
  id: number;
  name: string;
  password_hash: string;
  locked_at: Date | string | null;
  lock_reason: string | null;
}

export function getPasswordRow(db: Kysely<DB>, name: string): Promise<PasswordRow | undefined> {
  return db
    .selectFrom('accounts')
    .select(['id', 'name', 'password_hash', 'locked_at', 'lock_reason'])
    .where('name', '=', name)
    .executeTakeFirst();
}

export interface AccountEmailRow {
  id: number;
  name: string;
  email: string;
}

export function getAccountEmail(db: Kysely<DB>, name: string): Promise<AccountEmailRow | undefined> {
  return db
    .selectFrom('accounts')
    .select(['id', 'name', 'email'])
    .where('name', '=', name)
    .executeTakeFirst();
}

export async function updatePasswordHash(
  db: Kysely<DB>,
  accountId: number,
  passwordHash: string,
  passwordVersion: number,
): Promise<void> {
  await db
    .updateTable('accounts')
    .set({ password_hash: passwordHash, password_version: passwordVersion })
    .where('id', '=', accountId)
    .execute();
  await deleteSessions(db, accountId);
}

export interface AccountLock {
  lockedAt: Date;
  reason: string | null;
}

export async function getAccountLock(db: Kysely<DB>, accountId: number): Promise<AccountLock | null> {
  const row = await db
    .selectFrom('accounts')
    .select(['locked_at', 'lock_reason'])
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (row === undefined || row.locked_at === null) return null;
  return { lockedAt: toUtcDate(row.locked_at), reason: row.lock_reason };
}

export async function lockAccount(
  db: Kysely<DB>,
  accountId: number,
  reason: string | null = null,
): Promise<boolean> {
  const result = await db
    .updateTable('accounts')
    .set({ locked_at: toDbTimestamp(new Date()), lock_reason: reason })
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) return false;
  await deleteSessions(db, accountId);
  return true;
}

export async function unlockAccount(db: Kysely<DB>, accountId: number): Promise<boolean> {
  const result = await db
    .updateTable('accounts')
    .set({ locked_at: null, lock_reason: null })
    .where('id', '=', accountId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export type LoginEvent = 'create' | 'login' | 'enter';

export async function recordLoginEvent(
  db: Kysely<DB>,
  event: LoginEvent,
  accountId: number,
  ip: string | null,
  characterId: number | null = null,
): Promise<void> {
  await db
    .insertInto('login_history')
    .values({ account_id: accountId, character_id: characterId, ip, event })
    .execute();
}

export async function updateLastLogin(db: Kysely<DB>, accountId: number, ip: string): Promise<void> {
  await db
    .updateTable('accounts')
    .set({ last_login_at: toDbTimestamp(new Date()), last_ip: ip })
    .where('id', '=', accountId)
    .execute();
}

export const SESSION_TTL_MINUTES = 60;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function generateSessionToken(
  db: Kysely<DB>,
  accountId: number,
  ttlMinutes = SESSION_TTL_MINUTES,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db
    .insertInto('account_sessions')
    .values({
      account_id: accountId,
      token_hash: hashSessionToken(token),
      ttl: ttlMinutes,
      expires_at: toDbTimestamp(new Date(Date.now() + ttlMinutes * 60_000)),
    })
    .execute();
  return token;
}

export interface SessionRow {
  account_id: number;
  created_at: Date | string;
  ttl: number;
  expires_at: Date | string | null;
}

export async function getSession(db: Kysely<DB>, token: string): Promise<SessionRow | undefined> {
  return db
    .selectFrom('account_sessions')
    .select(['account_id', 'created_at', 'ttl', 'expires_at'])
    .where('token_hash', '=', hashSessionToken(token))
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
}

export function sessionExpired(session: SessionRow, now = Date.now()): boolean {
  const expiresAt =
    session.expires_at !== null
      ? toUtcDate(session.expires_at).getTime()
      : toUtcDate(session.created_at).getTime() + session.ttl * 60_000;
  return now >= expiresAt;
}

export async function deleteSessions(db: Kysely<DB>, accountId: number): Promise<void> {
  await db.deleteFrom('account_sessions').where('account_id', '=', accountId).execute();
}

export async function pruneExpiredSessions(db: Kysely<DB>, now: Date = new Date()): Promise<number> {
  const result = await db
    .deleteFrom('account_sessions')
    .where((eb) =>
      eb.or([eb('expires_at', 'is', null), eb('expires_at', '<=', toDbTimestamp(now))]),
    )
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}

export async function countCharacters(db: Kysely<DB>, accountId?: number): Promise<number> {
  let query = db.selectFrom('characters').select(({ fn }) => fn.countAll<number>().as('count'));
  if (accountId !== undefined) query = query.where('account_id', '=', accountId);
  const row = await query.executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function getCharacterList(
  db: Kysely<DB>,
  accountId: number,
  itemDb: PubData,
): Promise<CharacterSelectionListEntry[]> {
  const rows = await db
    .selectFrom('characters')
    .select([
      'id',
      'name',
      'level',
      'gender',
      'hair_style',
      'hair_color',
      'race',
      'admin_level',
      'boots',
      'armor',
      'hat',
      'shield',
      'weapon',
    ])
    .where('account_id', '=', accountId)
    .orderBy('id', 'asc')
    .execute();

  return rows.map((row) => {
    const entry = new CharacterSelectionListEntry();
    entry.id = row.id;
    entry.name = row.name;
    entry.level = row.level;
    entry.gender = row.gender as Gender;
    entry.hairStyle = row.hair_style;
    entry.hairColor = row.hair_color;
    entry.skin = row.race;
    entry.admin = row.admin_level as AdminLevel;
    const equipment = new EquipmentCharacterSelect();
    equipment.boots = itemDb.graphicId(row.boots);
    equipment.armor = itemDb.graphicId(row.armor);
    equipment.hat = itemDb.graphicId(row.hat);
    equipment.shield = itemDb.graphicId(row.shield);
    equipment.weapon = itemDb.graphicId(row.weapon);
    entry.equipment = equipment;
    return entry;
  });
}
