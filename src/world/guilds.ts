import { GuildAcceptServerPacket, TalkRequestServerPacket } from 'eolib';
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db/schema.ts';
import { ClientState } from '../player/client-state.ts';
import type { Player } from '../player/player.ts';
import type { ServerContext } from '../server-context.ts';

type Db = Kysely<DB> | Transaction<DB>;

export type GuildServer = Pick<ServerContext, 'db' | 'allPlayers'>;

export const LEADER_RANK = 1;
export const NEW_MEMBER_RANK = 9;
export const RANK_COUNT = 9;

export interface GuildRow {
  id: number;
  tag: string;
  name: string;
  description: string | null;
  bank: number;
  created_at: Date | string;
}

export interface GuildMemberRow {
  id: number;
  name: string;
  guild_rank: number | null;
  guild_rank_string: string | null;
}

export class GuildNameTakenError extends Error {
  constructor() {
    super('guild tag or name already exists');
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof GuildNameTakenError) return true;
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

export async function guildExists(db: Db, tag: string, name: string): Promise<boolean> {
  const row = await db
    .selectFrom('guilds')
    .select('id')
    .where((eb) =>
      eb.or([
        eb(eb.fn('upper', ['tag']), '=', tag.toUpperCase()),
        eb(eb.fn('lower', ['name']), '=', name.toLowerCase()),
      ]),
    )
    .executeTakeFirst();
  return row !== undefined;
}

export async function createGuild(
  db: Db,
  tag: string,
  name: string,
  description: string,
  defaultRanks: { leader: string; recruiter: string; newMember: string },
): Promise<number> {
  if (await guildExists(db, tag, name)) throw new GuildNameTakenError();
  const inserted = await db
    .insertInto('guilds')
    .values({ tag: tag.toUpperCase(), name, description })
    .returning('id')
    .executeTakeFirstOrThrow();

  const rankNames = Array.from({ length: RANK_COUNT }, () => '');
  rankNames[0] = defaultRanks.leader;
  rankNames[1] = defaultRanks.recruiter;
  rankNames[RANK_COUNT - 1] = defaultRanks.newMember;
  await db
    .insertInto('guild_ranks')
    .values(rankNames.map((rank, index) => ({ guild_id: inserted.id, index, rank })))
    .execute();
  return inserted.id;
}

export function getGuildById(db: Db, guildId: number): Promise<GuildRow | undefined> {
  return db
    .selectFrom('guilds')
    .selectAll()
    .where('id', '=', guildId)
    .executeTakeFirst() as Promise<GuildRow | undefined>;
}

export function getGuildByIdentity(db: Db, identity: string): Promise<GuildRow | undefined> {
  return db
    .selectFrom('guilds')
    .selectAll()
    .where((eb) =>
      eb.or([
        eb(eb.fn('upper', ['tag']), '=', identity.toUpperCase()),
        eb(eb.fn('lower', ['name']), '=', identity.toLowerCase()),
      ]),
    )
    .orderBy('id', 'asc')
    .executeTakeFirst() as Promise<GuildRow | undefined>;
}

export function getGuildByTag(db: Db, tag: string): Promise<GuildRow | undefined> {
  return db
    .selectFrom('guilds')
    .selectAll()
    .where('tag', '=', tag.toUpperCase())
    .executeTakeFirst() as Promise<GuildRow | undefined>;
}

export async function getGuildRanks(db: Db, guildId: number): Promise<string[]> {
  const rows = await db
    .selectFrom('guild_ranks')
    .select(['index', 'rank'])
    .where('guild_id', '=', guildId)
    .orderBy('index', 'asc')
    .execute();
  const ranks = Array.from({ length: RANK_COUNT }, () => '');
  for (const row of rows) {
    if (row.index >= 0 && row.index < RANK_COUNT) ranks[row.index] = row.rank;
  }
  return ranks;
}

export async function updateGuildRanks(
  db: Kysely<DB>,
  guildId: number,
  ranks: string[],
): Promise<number[]> {
  return db.transaction().execute(async (trx) => {
    const existing = await getGuildRanks(trx, guildId);
    const changed: number[] = [];
    for (let index = 0; index < Math.min(RANK_COUNT, ranks.length); index++) {
      const rank = ranks[index]!;
      if (existing[index] === rank) continue;
      changed.push(index + 1);
      await trx
        .updateTable('guild_ranks')
        .set({ rank })
        .where('guild_id', '=', guildId)
        .where('index', '=', index)
        .execute();
      await trx
        .updateTable('characters')
        .set({ guild_rank_string: rank })
        .where('guild_id', '=', guildId)
        .where('guild_rank', '=', index + 1)
        .execute();
    }
    return changed;
  });
}

export async function depositGuildBank(
  db: Db,
  guildId: number,
  amount: number,
  maxGold: number,
): Promise<boolean> {
  const result = await db
    .updateTable('guilds')
    .set((eb) => ({ bank: eb('bank', '+', amount) }))
    .where('id', '=', guildId)
    .where('bank', '<=', maxGold - amount)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function withdrawGuildBank(db: Db, guildId: number, amount: number): Promise<boolean> {
  const result = await db
    .updateTable('guilds')
    .set((eb) => ({ bank: eb('bank', '-', amount) }))
    .where('id', '=', guildId)
    .where('bank', '>=', amount)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function updateGuildDescription(
  db: Db,
  guildId: number,
  description: string,
): Promise<void> {
  await db.updateTable('guilds').set({ description }).where('id', '=', guildId).execute();
}

export function getGuildMembers(db: Db, guildId: number): Promise<GuildMemberRow[]> {
  return db
    .selectFrom('characters')
    .select(['id', 'name', 'guild_rank', 'guild_rank_string'])
    .where('guild_id', '=', guildId)
    .orderBy('guild_rank', 'asc')
    .orderBy('id', 'asc')
    .execute();
}

export function getGuildMemberByName(
  db: Db,
  guildId: number,
  name: string,
): Promise<GuildMemberRow | undefined> {
  return db
    .selectFrom('characters')
    .select(['id', 'name', 'guild_rank', 'guild_rank_string'])
    .where('guild_id', '=', guildId)
    .where('name', '=', name.toLowerCase())
    .executeTakeFirst();
}

export async function countGuildLeaders(db: Db, guildId: number): Promise<number> {
  const row = await db
    .selectFrom('characters')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('guild_id', '=', guildId)
    .where('guild_rank', '=', LEADER_RANK)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
}

export async function deleteGuild(db: Kysely<DB>, guildId: number): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('characters')
      .set({ guild_id: null, guild_rank: null, guild_rank_string: null })
      .where('guild_id', '=', guildId)
      .execute();
    await trx.deleteFrom('guild_ranks').where('guild_id', '=', guildId).execute();
    await trx.deleteFrom('guilds').where('id', '=', guildId).execute();
  });
}

export async function setMemberRank(
  db: Db,
  characterId: number,
  guildId: number,
  rank: number,
  rankString: string,
): Promise<boolean> {
  const result = await db
    .updateTable('characters')
    .set({ guild_rank: rank, guild_rank_string: rankString })
    .where('id', '=', characterId)
    .where('guild_id', '=', guildId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export async function clearMemberGuild(db: Db, characterId: number, guildId: number): Promise<boolean> {
  const result = await db
    .updateTable('characters')
    .set({ guild_id: null, guild_rank: null, guild_rank_string: null })
    .where('id', '=', characterId)
    .where('guild_id', '=', guildId)
    .executeTakeFirst();
  return Number(result.numUpdatedRows) === 1;
}

export function onlineGuildMembers(server: Pick<ServerContext, 'allPlayers'>, guildId: number): Player[] {
  const members: Player[] = [];
  for (const other of server.allPlayers()) {
    if (other.state === ClientState.InGame && other.character?.row.guild_id === guildId) {
      members.push(other);
    }
  }
  return members;
}

export function loadedGuildMembers(server: Pick<ServerContext, 'allPlayers'>, guildId: number): Player[] {
  const members: Player[] = [];
  for (const other of server.allPlayers()) {
    const loaded = other.state === ClientState.InGame || other.state === ClientState.EnteringGame;
    if (loaded && other.character?.row.guild_id === guildId) members.push(other);
  }
  return members;
}

export function guildAnnounce(
  server: Pick<ServerContext, 'allPlayers'>,
  guildId: number,
  message: string,
): void {
  const packet = new TalkRequestServerPacket();
  packet.playerName = 'Server';
  packet.message = message;
  for (const member of onlineGuildMembers(server, guildId)) member.bus.send(packet);
}

export async function ensureGuildLeader(server: GuildServer, guildId: number): Promise<void> {
  const members = await getGuildMembers(server.db, guildId);
  const online = new Map<number, Player>();
  for (const player of loadedGuildMembers(server, guildId)) {
    online.set(player.character!.id, player);
  }
  const ranked = members.map((member) => {
    const player = online.get(member.id);
    return { id: member.id, rank: player?.character?.row.guild_rank ?? member.guild_rank ?? NEW_MEMBER_RANK };
  });
  for (const [id, player] of online) {
    if (!ranked.some((member) => member.id === id)) {
      ranked.push({ id, rank: player.character?.row.guild_rank ?? NEW_MEMBER_RANK });
    }
  }
  if (ranked.length === 0) {
    await deleteGuild(server.db, guildId);
    return;
  }
  if (ranked.some((member) => member.rank === LEADER_RANK)) return;

  ranked.sort((a, b) => a.rank - b.rank || a.id - b.id);
  const heir = ranked[0]!;
  const ranks = await getGuildRanks(server.db, guildId);
  const rankString = ranks[0] ?? '';
  await setMemberRank(server.db, heir.id, guildId, LEADER_RANK, rankString);
  const player = online.get(heir.id);
  const character = player?.character;
  if (player !== undefined && character != null && character.row.guild_id === guildId) {
    character.row.guild_rank = LEADER_RANK;
    character.row.guild_rank_string = rankString;
    if (player.state !== ClientState.InGame) return;
    const accept = new GuildAcceptServerPacket();
    accept.rank = LEADER_RANK;
    player.bus.send(accept);
  }
}
