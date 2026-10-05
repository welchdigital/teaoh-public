import type { Kysely } from 'kysely';
import { toDbTimestamp, toUtcDate, type DB } from '../db/schema.ts';
import { log } from '../log.ts';
import type { ServerContext } from '../server-context.ts';
import { containsText } from './like.ts';
import { databaseOf } from './state.ts';

export type ActorKind = 'ingame' | 'api';

export interface AuditEntry {
  actorKind: ActorKind;
  actor: string;
  sourceIp: string | null;
  keyFingerprint?: string | null | undefined;
  action: string;
  target: string | null;
  details?: Record<string, unknown> | null | undefined;
}

export interface AuditRecord {
  id: number;
  at: Date;
  actorKind: ActorKind;
  actor: string;
  sourceIp: string | null;
  action: string;
  target: string | null;
  details: unknown;
  keyFingerprint: string | null;
}

const MAX_ACTOR = 64;
const MAX_ACTION = 64;
const MAX_TARGET = 128;
const MAX_IP = 45;

function clip(value: string | null, max: number): string | null {
  return value === null ? null : [...value].slice(0, max).join('');
}

export async function writeAudit(server: Pick<ServerContext, 'db'>, input: AuditEntry): Promise<void> {
  const entry =
    input.keyFingerprint === undefined || input.keyFingerprint === null
      ? input
      : { ...input, details: { ...input.details, keyFingerprint: input.keyFingerprint } };
  log.info(
    {
      cat: 'admin',
      actorKind: entry.actorKind,
      actor: entry.actor,
      sourceIp: entry.sourceIp,
      action: entry.action,
      target: entry.target,
      ...(entry.details === undefined || entry.details === null ? {} : { details: entry.details }),
    },
    'admin action',
  );
  const db = databaseOf(server);
  if (db === null) return;
  try {
    await db
      .insertInto('admin_audit')
      .values({
        created_at: toDbTimestamp(new Date()),
        actor_kind: entry.actorKind,
        actor: clip(entry.actor, MAX_ACTOR) ?? '',
        source_ip: clip(entry.sourceIp, MAX_IP),
        action: clip(entry.action, MAX_ACTION) ?? '',
        target: clip(entry.target, MAX_TARGET),
        details:
          entry.details === undefined || entry.details === null ? null : JSON.stringify(entry.details),
      })
      .execute();
  } catch (err) {
    log.error({ cat: 'admin', action: entry.action, err: String(err) }, 'failed to write admin audit');
  }
}

export interface ListAuditOptions {
  q?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

function filtered(db: Kysely<DB>, q: string | undefined) {
  let query = db.selectFrom('admin_audit');
  const needle = q?.trim().toLowerCase() ?? '';
  if (needle !== '') {
    query = query.where((eb) =>
      eb.or([
        containsText('actor', needle),
        containsText('action', needle),
        containsText('target', needle),
        containsText('details', needle),
      ]),
    );
  }
  return query;
}

function parseDetails(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function splitDetails(value: string | null): { details: unknown; keyFingerprint: string | null } {
  const parsed = parseDetails(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { details: parsed, keyFingerprint: null };
  }
  const { keyFingerprint, ...rest } = parsed as Record<string, unknown>;
  if (typeof keyFingerprint !== 'string') return { details: parsed, keyFingerprint: null };
  return { details: Object.keys(rest).length === 0 ? null : rest, keyFingerprint };
}

export async function listAudit(db: Kysely<DB>, options: ListAuditOptions = {}): Promise<AuditRecord[]> {
  const rows = await filtered(db, options.q)
    .selectAll()
    .orderBy('id', 'desc')
    .limit(Math.max(1, Math.min(500, Math.floor(options.limit ?? 50))))
    .offset(Math.max(0, Math.floor(options.offset ?? 0)))
    .execute();
  return rows.map((row) => ({
    id: row.id,
    at: toUtcDate(row.created_at),
    actorKind: row.actor_kind === 'ingame' ? 'ingame' : 'api',
    actor: row.actor,
    sourceIp: row.source_ip,
    action: row.action,
    target: row.target,
    ...splitDetails(row.details),
  }));
}

export async function countAudit(db: Kysely<DB>, q?: string): Promise<number> {
  const row = await filtered(db, q)
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}
