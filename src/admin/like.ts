import { sql, type RawBuilder, type SqlBool } from 'kysely';

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function containsText(column: string, needle: string, lower = true): RawBuilder<SqlBool> {
  const pattern = `%${escapeLike(needle)}%`;
  const ref = lower ? sql`lower(${sql.ref(column)})` : sql.ref(column);
  return sql<SqlBool>`${ref} like ${pattern} escape '\\'`;
}
