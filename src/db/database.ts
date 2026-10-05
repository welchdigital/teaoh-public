import SqliteDatabase from 'better-sqlite3';
import { Kysely, Migrator, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseConfig } from '../config.ts';
import { log } from '../log.ts';
import { buildMigrations } from './migrations.ts';
import type { DB } from './schema.ts';

export function createDatabase(config: DatabaseConfig): Kysely<DB> {
  if (config.driver === 'postgres') {
    const pool = new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.name,
      user: config.user,
      password: config.password,
      max: 10,
    });
    pool.on('error', (err) => {
      log.error({ cat: 'database', err: String(err) }, 'idle postgres client error');
    });
    return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  }

  const sqlite = new SqliteDatabase(config.sqlitePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
}

export async function migrateToLatest(db: Kysely<DB>, driver: 'sqlite' | 'postgres'): Promise<void> {
  const migrations = buildMigrations(driver);
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });

  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    if (result.status === 'Success') {
      log.info({ migration: result.migrationName }, 'migration applied');
    } else if (result.status === 'Error') {
      log.error({ migration: result.migrationName }, 'migration failed');
    }
  }
  if (error) throw error;
}
