import type { Kysely } from 'kysely';
import { toDbTimestamp, toUtcDate, type DB } from '../db/schema.ts';
import { normalizeIp } from '../net/ip.ts';
import { normalizeHdid } from './accounts.ts';

const MAX_BAN_NAME_LENGTH = 16;
const MAX_BANNED_BY_LENGTH = 64;

export interface BanQuery {
  accountId?: number | undefined;
  ip?: string | undefined;
  hdid?: string | undefined;
}

export interface Ban {
  id: number;
  accountId: number | null;
  characterName: string | null;
  ip: string | null;
  hdid: string | null;
  reason: string | null;
  bannedBy: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedBy: string | null;
}

export interface ActiveBan extends Ban {
  permanent: boolean;
  minutesRemaining: number | null;
}

export interface BanListEntry extends Ban {
  accountName: string | null;
  active: boolean;
}

export interface CreateBanOptions {
  accountId?: number | null | undefined;
  characterName?: string | null | undefined;
  ip?: string | null | undefined;
  hdid?: string | null | undefined;
  durationMinutes: number | null;
  reason?: string | null | undefined;
  bannedBy: string;
}

export interface ListBansOptions {
  active?: boolean | undefined;
  accountId?: number | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

type BanRow = {
  id: number;
  account_id: number | null;
  character_name: string | null;
  ip: string | null;
  hdid: string | null;
  reason: string | null;
  banned_by: string | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
};

const BAN_COLUMNS = [
  'bans.id',
  'bans.account_id',
  'bans.character_name',
  'bans.ip',
  'bans.hdid',
  'bans.reason',
  'bans.banned_by',
  'bans.created_at',
  'bans.expires_at',
  'bans.revoked_at',
  'bans.revoked_by',
] as const;

function toBan(row: BanRow): Ban {
  return {
    id: row.id,
    accountId: row.account_id,
    characterName: row.character_name,
    ip: row.ip,
    hdid: row.hdid,
    reason: row.reason,
    bannedBy: row.banned_by,
    createdAt: toUtcDate(row.created_at),
    expiresAt: row.expires_at === null ? null : toUtcDate(row.expires_at),
    revokedAt: row.revoked_at === null ? null : toUtcDate(row.revoked_at),
    revokedBy: row.revoked_by,
  };
}

function isActive(ban: Ban, now: Date): boolean {
  if (ban.revokedAt !== null) return false;
  return ban.expiresAt === null || ban.expiresAt.getTime() > now.getTime();
}

function usable(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '' && value !== 'unknown';
}

export async function findActiveBan(
  db: Kysely<DB>,
  query: BanQuery,
  now: Date = new Date(),
): Promise<ActiveBan | null> {
  const accountId = query.accountId !== undefined && query.accountId > 0 ? query.accountId : undefined;
  const ip = usable(query.ip) ? (normalizeIp(query.ip) ?? undefined) : undefined;
  const hdid = usable(query.hdid) ? (normalizeHdid(query.hdid) ?? undefined) : undefined;
  if (accountId === undefined && ip === undefined && hdid === undefined) return null;

  const nowValue = toDbTimestamp(now);
  const rows = await db
    .selectFrom('bans')
    .select(BAN_COLUMNS)
    .where('bans.revoked_at', 'is', null)
    .where((eb) => eb.or([eb('bans.expires_at', 'is', null), eb('bans.expires_at', '>', nowValue)]))
    .where((eb) => {
      const matches = [];
      if (accountId !== undefined) matches.push(eb('bans.account_id', '=', accountId));
      if (ip !== undefined) matches.push(eb('bans.ip', '=', ip));
      if (hdid !== undefined) matches.push(eb('bans.hdid', '=', hdid));
      return eb.or(matches);
    })
    .execute();

  let best: Ban | null = null;
  for (const row of rows) {
    const ban = toBan(row);
    if (!isActive(ban, now)) continue;
    if (
      best === null ||
      (best.expiresAt !== null &&
        (ban.expiresAt === null || ban.expiresAt.getTime() > best.expiresAt.getTime()))
    ) {
      best = ban;
    }
  }
  if (best === null) return null;

  const permanent = best.expiresAt === null;
  return {
    ...best,
    permanent,
    minutesRemaining: permanent
      ? null
      : Math.max(1, Math.ceil((best.expiresAt!.getTime() - now.getTime()) / 60_000)),
  };
}

export async function createBan(db: Kysely<DB>, options: CreateBanOptions): Promise<number> {
  const permanent = options.durationMinutes === null || !(options.durationMinutes > 0);
  const expiresAt = permanent
    ? null
    : toDbTimestamp(new Date(Date.now() + Math.floor(options.durationMinutes! * 60_000)));
  const accountId = options.accountId !== undefined && options.accountId !== null && options.accountId > 0
    ? options.accountId
    : null;
  const ip = banIp(options.ip);
  const hdid = banHdid(options.hdid);

  const inserted = await db
    .insertInto('bans')
    .values({
      account_id: accountId,
      character_name: options.characterName?.slice(0, MAX_BAN_NAME_LENGTH) ?? null,
      ip,
      hdid,
      reason: options.reason ?? null,
      banned_by: options.bannedBy.slice(0, MAX_BANNED_BY_LENGTH),
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  if (accountId !== null) {
    await db.deleteFrom('account_sessions').where('account_id', '=', accountId).execute();
  }
  return inserted.id;
}

function banIp(value: string | null | undefined): string | null {
  if (!usable(value ?? undefined)) return null;
  const ip = normalizeIp(value);
  if (ip === null) throw new Error(`invalid ban ip "${value}"`);
  return ip;
}

function banHdid(value: string | null | undefined): string | null {
  if (!usable(value ?? undefined)) return null;
  const hdid = normalizeHdid(value!);
  if (hdid === null || hdid === '') throw new Error('invalid ban hdid');
  return hdid;
}

export async function revokeBan(db: Kysely<DB>, id: number, revokedBy: string): Promise<boolean> {
  const result = await db
    .updateTable('bans')
    .set({ revoked_at: toDbTimestamp(new Date()), revoked_by: revokedBy })
    .where('id', '=', id)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) > 0;
}

export async function listBans(
  db: Kysely<DB>,
  options: ListBansOptions = {},
  now: Date = new Date(),
): Promise<BanListEntry[]> {
  const nowValue = toDbTimestamp(now);
  let query = db
    .selectFrom('bans')
    .leftJoin('accounts', 'accounts.id', 'bans.account_id')
    .select([...BAN_COLUMNS, 'accounts.name as account_name']);

  if (options.accountId !== undefined) query = query.where('bans.account_id', '=', options.accountId);
  if (options.active === true) {
    query = query
      .where('bans.revoked_at', 'is', null)
      .where((eb) =>
        eb.or([eb('bans.expires_at', 'is', null), eb('bans.expires_at', '>', nowValue)]),
      );
  } else if (options.active === false) {
    query = query.where((eb) =>
      eb.or([
        eb('bans.revoked_at', 'is not', null),
        eb.and([eb('bans.expires_at', 'is not', null), eb('bans.expires_at', '<=', nowValue)]),
      ]),
    );
  }

  const rows = await query
    .orderBy('bans.id', 'desc')
    .limit(Math.max(1, Math.min(500, Math.floor(options.limit ?? 50))))
    .offset(Math.max(0, Math.floor(options.offset ?? 0)))
    .execute();

  return rows.map((row) => {
    const ban = toBan(row);
    return { ...ban, accountName: row.account_name, active: isActive(ban, now) };
  });
}

export async function countBans(
  db: Kysely<DB>,
  options: Pick<ListBansOptions, 'active'> = {},
  now: Date = new Date(),
): Promise<number> {
  const nowValue = toDbTimestamp(now);
  let query = db.selectFrom('bans').select(({ fn }) => fn.countAll<number>().as('count'));
  if (options.active === true) {
    query = query
      .where('bans.revoked_at', 'is', null)
      .where((eb) =>
        eb.or([eb('bans.expires_at', 'is', null), eb('bans.expires_at', '>', nowValue)]),
      );
  } else if (options.active === false) {
    query = query.where((eb) =>
      eb.or([
        eb('bans.revoked_at', 'is not', null),
        eb.and([eb('bans.expires_at', 'is not', null), eb('bans.expires_at', '<=', nowValue)]),
      ]),
    );
  }
  const row = await query.executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function getBan(db: Kysely<DB>, id: number, now: Date = new Date()): Promise<BanListEntry | null> {
  const row = await db
    .selectFrom('bans')
    .leftJoin('accounts', 'accounts.id', 'bans.account_id')
    .select([...BAN_COLUMNS, 'accounts.name as account_name'])
    .where('bans.id', '=', id)
    .executeTakeFirst();
  if (row === undefined) return null;
  const ban = toBan(row);
  return { ...ban, accountName: row.account_name, active: isActive(ban, now) };
}

export async function activeBanAccountIds(
  db: Kysely<DB>,
  accountIds: readonly number[],
  now: Date = new Date(),
): Promise<Set<number>> {
  if (accountIds.length === 0) return new Set();
  const nowValue = toDbTimestamp(now);
  const rows = await db
    .selectFrom('bans')
    .select('account_id')
    .where('account_id', 'in', [...new Set(accountIds)])
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', nowValue)]))
    .execute();
  return new Set(rows.flatMap((row) => (row.account_id === null ? [] : [row.account_id])));
}
