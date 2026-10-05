import { sql, type Kysely, type Migration } from 'kysely';
import { log } from '../log.ts';

type AnyDb = Kysely<unknown>;
type Driver = 'sqlite' | 'postgres';

function withIdColumn(db: AnyDb, table: string, driver: Driver) {
  const builder = db.schema.createTable(table);
  return driver === 'postgres'
    ? builder.addColumn('id', 'serial', (c) => c.primaryKey())
    : builder.addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement());
}

const now = sql`CURRENT_TIMESTAMP`;

export function timestampType(driver: Driver): 'timestamp' | 'timestamptz' {
  return driver === 'postgres' ? 'timestamptz' : 'timestamp';
}

const POSTGRES_TIMESTAMP_COLUMNS: Array<[string, string]> = [
  ['accounts', 'created_at'],
  ['account_sessions', 'created_at'],
  ['guilds', 'created_at'],
  ['characters', 'created_at'],
  ['character_quest_progress', 'done_at'],
  ['board_posts', 'created_at'],
];

async function migrateAccounts(db: AnyDb, driver: Driver): Promise<void> {
  const ts = timestampType(driver);

  if (driver === 'postgres') {
    for (const [table, column] of POSTGRES_TIMESTAMP_COLUMNS) {
      await db.schema
        .alterTable(table)
        .alterColumn(column, (c) => c.setDataType('timestamptz'))
        .execute();
    }
  }

  await withIdColumn(db, 'bans_new', driver)
    .addColumn('account_id', 'integer', (c) => c.references('accounts.id').onDelete('set null'))
    .addColumn('character_name', 'varchar(16)')
    .addColumn('ip', 'varchar(45)')
    .addColumn('hdid', 'varchar(64)')
    .addColumn('reason', 'text')
    .addColumn('banned_by', 'varchar(64)')
    .addColumn('created_at', ts, (c) => c.notNull().defaultTo(now))
    .addColumn('expires_at', ts)
    .addColumn('revoked_at', ts)
    .addColumn('revoked_by', 'varchar(64)')
    .execute();

  const expiresAt =
    driver === 'postgres'
      ? sql`created_at + make_interval(mins => duration)`
      : sql`strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || duration || ' minutes')`;
  await sql`
    INSERT INTO bans_new (account_id, ip, created_at, expires_at)
    SELECT account_id, ip, created_at,
      CASE WHEN duration IS NULL OR duration <= 0 THEN NULL ELSE ${expiresAt} END
    FROM bans
  `.execute(db);

  await db.schema.dropTable('bans').execute();
  await db.schema.alterTable('bans_new').renameTo('bans').execute();
  await db.schema.createIndex('idx_bans_account_id').on('bans').column('account_id').execute();
  await db.schema.createIndex('idx_bans_ip').on('bans').column('ip').execute();
  await db.schema.createIndex('idx_bans_hdid').on('bans').column('hdid').execute();

  await db.schema.alterTable('accounts').addColumn('last_login_at', ts).execute();
  await db.schema.alterTable('accounts').addColumn('last_ip', 'varchar(45)').execute();
  await db.schema.alterTable('accounts').addColumn('locked_at', ts).execute();
  await db.schema.alterTable('accounts').addColumn('lock_reason', 'text').execute();

  await withIdColumn(db, 'login_history', driver)
    .addColumn('account_id', 'integer', (c) =>
      c.notNull().references('accounts.id').onDelete('cascade'),
    )
    .addColumn('character_id', 'integer', (c) =>
      c.references('characters.id').onDelete('set null'),
    )
    .addColumn('ip', 'varchar(45)')
    .addColumn('event', 'varchar(16)', (c) => c.notNull())
    .addColumn('created_at', ts, (c) => c.notNull().defaultTo(now))
    .execute();
  await db.schema
    .createIndex('idx_login_history_account_id')
    .on('login_history')
    .column('account_id')
    .execute();

  await sql`DELETE FROM account_sessions`.execute(db);
  await db.schema.alterTable('account_sessions').renameColumn('token', 'token_hash').execute();
  await db.schema.alterTable('account_sessions').addColumn('expires_at', ts).execute();
  await db.schema
    .createIndex('idx_account_sessions_account_id')
    .on('account_sessions')
    .column('account_id')
    .execute();
}

async function migrateSocial(db: AnyDb): Promise<void> {
  const duplicates = await sql<{ id: number; tag: string; name: string }>`
    SELECT id, tag, name FROM guilds
    WHERE lower(name) IN (SELECT lower(name) FROM guilds GROUP BY lower(name) HAVING COUNT(*) > 1)
    ORDER BY lower(name), id
  `.execute(db);
  if (duplicates.rows.length === 0) {
    await sql`CREATE UNIQUE INDEX idx_guilds_name_lower ON guilds (lower(name))`.execute(db);
  } else {
    const guilds = duplicates.rows.map((row) => `${row.name} [${row.tag}] (id ${row.id})`);
    log.warn(
      { cat: 'database', migration: '0007_social', guilds },
      `guild names differ only by case, so the case-insensitive unique index idx_guilds_name_lower was not created; rename these guilds and recreate it: ${guilds.join(', ')}`,
    );
  }
  await sql`
    UPDATE board_posts SET board_id = 4
    WHERE board_id = 5 AND (subject LIKE '[Report]%' OR subject LIKE '[Request]%')
  `.execute(db);
}

export function buildMigrations(driver: Driver): Record<string, Migration> {
  return {
    '0001_init': {
      async up(db: AnyDb): Promise<void> {
        await withIdColumn(db, 'accounts', driver)
          .addColumn('name', 'text', (c) => c.notNull().unique())
          .addColumn('password_hash', 'text', (c) => c.notNull())
          .addColumn('password_version', 'integer', (c) => c.notNull().defaultTo(1))
          .addColumn('email', 'text', (c) => c.notNull())
          .addColumn('real_name', 'text', (c) => c.notNull())
          .addColumn('location', 'text', (c) => c.notNull())
          .addColumn('computer', 'text', (c) => c.notNull())
          .addColumn('hdid', 'text', (c) => c.notNull())
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .execute();

        await withIdColumn(db, 'account_sessions', driver)
          .addColumn('account_id', 'integer', (c) =>
            c.notNull().references('accounts.id').onDelete('cascade'),
          )
          .addColumn('token', 'varchar(100)', (c) => c.notNull())
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .addColumn('ttl', 'integer', (c) => c.notNull().defaultTo(60))
          .execute();

        await db.schema
          .createTable('bans')
          .addColumn('account_id', 'integer', (c) =>
            c.references('accounts.id').onDelete('cascade'),
          )
          .addColumn('ip', 'varchar(45)')
          .addColumn('duration', 'integer')
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .execute();

        await withIdColumn(db, 'guilds', driver)
          .addColumn('tag', 'varchar(3)', (c) => c.notNull().unique())
          .addColumn('name', 'varchar(32)', (c) => c.notNull().unique())
          .addColumn('description', 'text')
          .addColumn('bank', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .execute();

        await withIdColumn(db, 'guild_ranks', driver)
          .addColumn('guild_id', 'integer', (c) =>
            c.notNull().references('guilds.id').onDelete('cascade'),
          )
          .addColumn('index', 'integer', (c) => c.notNull())
          .addColumn('rank', 'varchar(64)', (c) => c.notNull())
          .execute();

        let characters = withIdColumn(db, 'characters', driver)
          .addColumn('account_id', 'integer', (c) =>
            c.notNull().references('accounts.id').onDelete('cascade'),
          )
          .addColumn('name', 'varchar(16)', (c) => c.notNull().unique())
          .addColumn('map', 'integer', (c) => c.notNull().defaultTo(192))
          .addColumn('x', 'integer', (c) => c.notNull().defaultTo(7))
          .addColumn('y', 'integer', (c) => c.notNull().defaultTo(6))
          .addColumn('direction', 'integer', (c) => c.notNull().defaultTo(2))
          .addColumn('sitting', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('hidden', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('title', 'varchar(32)')
          .addColumn('home', 'varchar(32)')
          .addColumn('fiance', 'varchar(16)')
          .addColumn('partner', 'varchar(16)')
          .addColumn('admin_level', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('class', 'integer', (c) => c.notNull().defaultTo(1))
          .addColumn('gender', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('race', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('hair_style', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('hair_color', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('bank_level', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('gold_bank', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('guild_id', 'integer', (c) => c.references('guilds.id').onDelete('set null'))
          .addColumn('guild_rank', 'integer')
          .addColumn('guild_rank_string', 'varchar(16)')
          .addColumn('level', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('experience', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('hp', 'integer', (c) => c.notNull().defaultTo(10))
          .addColumn('tp', 'integer', (c) => c.notNull().defaultTo(10))
          .addColumn('strength', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('intelligence', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('wisdom', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('agility', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('constitution', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('charisma', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('stat_points', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('skill_points', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('karma', 'integer', (c) => c.notNull().defaultTo(1000))
          .addColumn('usage', 'integer', (c) => c.notNull().defaultTo(0));
        for (const slot of [
          'boots',
          'accessory',
          'gloves',
          'belt',
          'armor',
          'necklace',
          'hat',
          'shield',
          'weapon',
          'ring',
          'ring2',
          'armlet',
          'armlet2',
          'bracer',
          'bracer2',
        ]) {
          characters = characters.addColumn(slot, 'integer', (c) => c.notNull().defaultTo(0));
        }
        await characters
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .execute();

        for (const table of ['character_inventory', 'character_bank'] as const) {
          await db.schema
            .createTable(table)
            .addColumn('character_id', 'integer', (c) =>
              c.notNull().references('characters.id').onDelete('cascade'),
            )
            .addColumn('item_id', 'integer', (c) => c.notNull())
            .addColumn('quantity', 'integer', (c) => c.notNull().defaultTo(1))
            .addPrimaryKeyConstraint(`${table}_pk`, ['character_id', 'item_id'])
            .execute();
        }

        await db.schema
          .createTable('character_spells')
          .addColumn('character_id', 'integer', (c) =>
            c.notNull().references('characters.id').onDelete('cascade'),
          )
          .addColumn('spell_id', 'integer', (c) => c.notNull())
          .addColumn('level', 'integer', (c) => c.notNull().defaultTo(0))
          .addPrimaryKeyConstraint('character_spells_pk', ['character_id', 'spell_id'])
          .execute();

        await db.schema
          .createTable('character_quest_progress')
          .addColumn('character_id', 'integer', (c) =>
            c.notNull().references('characters.id').onDelete('cascade'),
          )
          .addColumn('quest_id', 'integer', (c) => c.notNull())
          .addColumn('state', 'integer', (c) => c.notNull())
          .addColumn('npc_kills', 'text', (c) => c.notNull())
          .addColumn('player_kills', 'integer', (c) => c.notNull())
          .addColumn('done_at', 'timestamp')
          .addColumn('completions', 'integer', (c) => c.notNull())
          .addPrimaryKeyConstraint('character_quest_progress_pk', ['character_id', 'quest_id'])
          .execute();

        await db.schema
          .createIndex('idx_characters_account_id')
          .on('characters')
          .column('account_id')
          .execute();
        await db.schema
          .createIndex('idx_characters_guild_id')
          .on('characters')
          .column('guild_id')
          .execute();
        await db.schema.createIndex('idx_bans_account_id').on('bans').column('account_id').execute();
        await db.schema.createIndex('idx_bans_ip').on('bans').column('ip').execute();
        await db.schema
          .createIndex('idx_account_sessions_token')
          .on('account_sessions')
          .column('token')
          .execute();
      },
    },
    '0002_boards': {
      async up(db: AnyDb): Promise<void> {
        await withIdColumn(db, 'board_posts', driver)
          .addColumn('board_id', 'integer', (c) => c.notNull())
          .addColumn('character_id', 'integer', (c) =>
            c.notNull().references('characters.id').onDelete('cascade'),
          )
          .addColumn('author', 'varchar(16)', (c) => c.notNull())
          .addColumn('subject', 'varchar(64)', (c) => c.notNull())
          .addColumn('body', 'varchar(2048)', (c) => c.notNull())
          .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
          .execute();
        await db.schema
          .createIndex('idx_board_posts_board_id')
          .on('board_posts')
          .column('board_id')
          .execute();
      },
    },
    '0003_accounts': {
      async up(db: AnyDb): Promise<void> {
        await migrateAccounts(db, driver);
      },
    },
    '0005_world': {
      async up(db: AnyDb): Promise<void> {
        await db.schema
          .createTable('character_auto_pickup')
          .addColumn('character_id', 'integer', (c) =>
            c.notNull().references('characters.id').onDelete('cascade'),
          )
          .addColumn('item_id', 'integer', (c) => c.notNull())
          .addPrimaryKeyConstraint('character_auto_pickup_pk', ['character_id', 'item_id'])
          .execute();
      },
    },
    '0007_social': {
      async up(db: AnyDb): Promise<void> {
        await migrateSocial(db);
      },
    },
    '0009_admin': {
      async up(db: AnyDb): Promise<void> {
        await migrateAdmin(db, driver);
      },
    },
  };
}

async function migrateAdmin(db: AnyDb, driver: Driver): Promise<void> {
  const ts = timestampType(driver);

  await withIdColumn(db, 'mutes', driver)
    .addColumn('character_id', 'integer', (c) =>
      c.notNull().references('characters.id').onDelete('cascade'),
    )
    .addColumn('character_name', 'varchar(16)', (c) => c.notNull())
    .addColumn('reason', 'text')
    .addColumn('muted_by', 'varchar(64)')
    .addColumn('created_at', ts, (c) => c.notNull().defaultTo(now))
    .addColumn('expires_at', ts)
    .addColumn('revoked_at', ts)
    .addColumn('revoked_by', 'varchar(64)')
    .execute();
  await db.schema.createIndex('idx_mutes_character_id').on('mutes').column('character_id').execute();

  await withIdColumn(db, 'reports', driver)
    .addColumn('kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('reporter_id', 'integer', (c) =>
      c.references('characters.id').onDelete('set null'),
    )
    .addColumn('reporter', 'varchar(16)', (c) => c.notNull())
    .addColumn('reportee', 'varchar(16)')
    .addColumn('message', 'text', (c) => c.notNull())
    .addColumn('created_at', ts, (c) => c.notNull().defaultTo(now))
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('open'))
    .addColumn('resolved_by', 'varchar(64)')
    .addColumn('resolved_at', ts)
    .addColumn('note', 'text')
    .execute();
  await db.schema.createIndex('idx_reports_status').on('reports').column('status').execute();

  await withIdColumn(db, 'admin_audit', driver)
    .addColumn('created_at', ts, (c) => c.notNull().defaultTo(now))
    .addColumn('actor_kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('actor', 'varchar(64)', (c) => c.notNull())
    .addColumn('source_ip', 'varchar(45)')
    .addColumn('action', 'varchar(64)', (c) => c.notNull())
    .addColumn('target', 'varchar(128)')
    .addColumn('details', 'text')
    .execute();
}
