import type { Kysely } from 'kysely';
import { toDbTimestamp, toUtcDate, type DB } from '../db/schema.ts';

export type ReportKind = 'report' | 'request';
export type ReportStatus = 'open' | 'resolved';

export interface ReportRecord {
  id: number;
  kind: ReportKind;
  reporterId: number | null;
  reporter: string;
  reportee: string | null;
  message: string;
  createdAt: Date;
  status: ReportStatus;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  note: string | null;
}

type ReportRow = {
  id: number;
  kind: string;
  reporter_id: number | null;
  reporter: string;
  reportee: string | null;
  message: string;
  created_at: Date | string;
  status: string;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  note: string | null;
};

function toRecord(row: ReportRow): ReportRecord {
  return {
    id: row.id,
    kind: row.kind === 'request' ? 'request' : 'report',
    reporterId: row.reporter_id,
    reporter: row.reporter,
    reportee: row.reportee,
    message: row.message,
    createdAt: toUtcDate(row.created_at),
    status: row.status === 'resolved' ? 'resolved' : 'open',
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at === null ? null : toUtcDate(row.resolved_at),
    note: row.note,
  };
}

export interface CreateReportOptions {
  kind: ReportKind;
  reporterId: number | null;
  reporter: string;
  reportee: string | null;
  message: string;
}

export async function createReport(db: Kysely<DB>, options: CreateReportOptions): Promise<number> {
  const inserted = await db
    .insertInto('reports')
    .values({
      kind: options.kind,
      reporter_id: options.reporterId,
      reporter: options.reporter,
      reportee: options.reportee,
      message: options.message,
      created_at: toDbTimestamp(new Date()),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

export interface ListReportsOptions {
  status?: ReportStatus | 'all' | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
}

function filtered(db: Kysely<DB>, status: ListReportsOptions['status']) {
  let query = db.selectFrom('reports');
  if (status === 'open' || status === 'resolved') query = query.where('status', '=', status);
  return query;
}

export async function listReports(db: Kysely<DB>, options: ListReportsOptions = {}): Promise<ReportRecord[]> {
  const rows = await filtered(db, options.status)
    .selectAll()
    .orderBy('id', 'desc')
    .limit(Math.max(1, Math.min(500, Math.floor(options.limit ?? 50))))
    .offset(Math.max(0, Math.floor(options.offset ?? 0)))
    .execute();
  return rows.map(toRecord);
}

export async function countReports(db: Kysely<DB>, status: ListReportsOptions['status']): Promise<number> {
  const row = await filtered(db, status)
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function getReport(db: Kysely<DB>, id: number): Promise<ReportRecord | null> {
  const row = await db.selectFrom('reports').selectAll().where('id', '=', id).executeTakeFirst();
  return row === undefined ? null : toRecord(row);
}

export async function resolveReport(
  db: Kysely<DB>,
  id: number,
  resolvedBy: string,
  note: string | null,
): Promise<ReportRecord | null> {
  await db
    .updateTable('reports')
    .set({ status: 'resolved', resolved_by: resolvedBy, resolved_at: toDbTimestamp(new Date()), note })
    .where('id', '=', id)
    .execute();
  return getReport(db, id);
}

export async function reopenReport(db: Kysely<DB>, id: number): Promise<ReportRecord | null> {
  await db
    .updateTable('reports')
    .set({ status: 'open', resolved_by: null, resolved_at: null, note: null })
    .where('id', '=', id)
    .execute();
  return getReport(db, id);
}
