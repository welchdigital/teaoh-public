import {
  AdminLevel,
  BoardCreateClientPacket,
  BoardOpenClientPacket,
  BoardOpenServerPacket,
  BoardPlayerServerPacket,
  BoardPostListing,
  BoardRemoveClientPacket,
  BoardTakeClientPacket,
  EoReader,
  MapTileSpec,
  PacketAction,
  SHORT_MAX,
} from 'eolib';
import type { Kysely } from 'kysely';
import type { Character } from '../../character/character.ts';
import type { Config } from '../../config.ts';
import { toUtcDate, type DB } from '../../db/schema.ts';
import { log } from '../../log.ts';
import type { ServerContext } from '../../server-context.ts';
import { inClientRange } from '../../world/coords.ts';
import type { GameMap } from '../../world/map/game-map.ts';
import { tileSpec } from '../../world/map/tiles.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

export const BOARD_COUNT = 8;
const MAX_CLIENT_RANGE = 14;
const MINUTE_MS = 60_000;

export interface BoardAuthor {
  id: number;
  name: string;
}

interface BoardSession {
  boardId: number | null;
  handles: Map<number, number>;
  postIds: Map<number, number>;
  nextHandle: number;
}

const boardSessions = new WeakMap<Player, BoardSession>();

function boardSession(player: Player): BoardSession {
  let session = boardSessions.get(player);
  if (session === undefined) {
    session = { boardId: null, handles: new Map(), postIds: new Map(), nextHandle: 1 };
    boardSessions.set(player, session);
  }
  return session;
}

function postHandle(session: BoardSession, postId: number): number {
  const known = session.handles.get(postId);
  if (known !== undefined) return known;
  const handle = session.nextHandle++;
  session.handles.set(postId, handle);
  session.postIds.set(handle, postId);
  return handle;
}

export function adminBoardId(config: Config): number {
  return config.board.adminBoard - 1;
}

export function boardPostLimit(config: Config, boardId: number): number {
  return boardId === adminBoardId(config) ? config.board.adminMaxPosts : config.board.maxPosts;
}

export function canReadBoard(config: Config, character: Character, boardId: number): boolean {
  return boardId !== adminBoardId(config) || character.row.admin_level >= AdminLevel.Spy;
}

export function canDeleteBoardPosts(character: Character): boolean {
  return character.row.admin_level >= AdminLevel.Guardian;
}

export function nearBoard(map: GameMap, character: Character, boardId: number): boolean {
  if (!Number.isInteger(boardId) || boardId < 0 || boardId >= BOARD_COUNT) return false;
  const spec = MapTileSpec.Board1 + boardId;
  const { x: cx, y: cy } = character.row;
  for (let dy = -MAX_CLIENT_RANGE; dy <= MAX_CLIENT_RANGE; dy++) {
    const span = MAX_CLIENT_RANGE - Math.abs(dy);
    for (let dx = -span; dx <= span; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (tileSpec(map, x, y) === spec && inClientRange(cx, cy, x, y)) return true;
    }
  }
  return false;
}

export function formatPostAge(createdAt: Date, now = Date.now()): string {
  const seconds = Math.floor((now - createdAt.getTime()) / 1000);
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  const days = Math.floor(seconds / 86_400);
  if (days >= 7) return plural(Math.floor(days / 7), 'week');
  if (days >= 1) return plural(days, 'day');
  if (seconds >= 3600) return plural(Math.floor(seconds / 3600), 'hour');
  if (seconds >= 60) return plural(Math.floor(seconds / 60), 'minute');
  if (seconds >= 1) return plural(seconds, 'second');
  return 'just now';
}

function clip(text: string, max: number): string {
  return [...text].slice(0, max).join('').trim();
}

export async function createBoardPost(
  db: Kysely<DB>,
  config: Config,
  boardId: number,
  author: BoardAuthor,
  subject: string,
  body: string,
): Promise<boolean> {
  const board = config.board;
  const postSubject = clip(subject, board.maxSubjectLength);
  const postBody = clip(body, board.maxPostLength);
  if (postSubject.length === 0 || postBody.length === 0) return false;
  const limit = boardPostLimit(config, boardId);

  return db.transaction().execute(async (trx) => {
    const recent = await trx
      .selectFrom('board_posts')
      .select('created_at')
      .where('board_id', '=', boardId)
      .where('character_id', '=', author.id)
      .orderBy('id', 'desc')
      .limit(board.maxRecentPosts)
      .execute();
    const cutoff = Date.now() - board.recentPostTime * MINUTE_MS;
    const recentCount = recent.filter((post) => toUtcDate(post.created_at).getTime() > cutoff).length;
    if (recentCount >= board.maxRecentPosts) return false;

    const visible = await trx
      .selectFrom('board_posts')
      .select('character_id')
      .where('board_id', '=', boardId)
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
    const own = visible.filter((post) => post.character_id === author.id).length;
    if (own >= board.maxUserPosts) return false;

    await trx
      .insertInto('board_posts')
      .values({
        board_id: boardId,
        character_id: author.id,
        author: author.name,
        subject: postSubject,
        body: postBody,
      })
      .execute();

    const stale = await trx
      .selectFrom('board_posts')
      .select('id')
      .where('board_id', '=', boardId)
      .orderBy('id', 'desc')
      .offset(limit)
      .limit(1000)
      .execute();
    if (stale.length > 0) {
      await trx
        .deleteFrom('board_posts')
        .where('id', 'in', stale.map((row) => row.id))
        .execute();
    }
    return true;
  });
}

export async function postToAdminBoard(
  server: Pick<ServerContext, 'db' | 'config'>,
  author: BoardAuthor,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    return await createBoardPost(
      server.db,
      server.config,
      adminBoardId(server.config),
      author,
      subject,
      body,
    );
  } catch (err) {
    log.error({ author: author.name, err: String(err) }, 'admin board post failed');
    return false;
  }
}

async function sendBoardListing(player: Player, boardId: number): Promise<void> {
  const config = player.config;
  const posts = await player.server.db
    .selectFrom('board_posts')
    .select(['id', 'author', 'subject', 'created_at'])
    .where('board_id', '=', boardId)
    .orderBy('id', 'desc')
    .limit(boardPostLimit(config, boardId))
    .execute();

  const session = boardSession(player);
  const unseen = posts.filter((post) => !session.handles.has(post.id)).length;
  if (session.nextHandle + unseen > SHORT_MAX) {
    session.handles.clear();
    session.postIds.clear();
    session.nextHandle = 1;
  }

  const now = Date.now();
  const reply = new BoardOpenServerPacket();
  reply.boardId = boardId + 1;
  reply.posts = posts.map((post) => {
    const listing = new BoardPostListing();
    listing.postId = postHandle(session, post.id);
    listing.author = post.author;
    listing.subject = config.board.datePosts
      ? `${post.subject} (${formatPostAge(toUtcDate(post.created_at), now)})`
      : post.subject;
    return listing;
  });
  player.bus.send(reply);
}

function activeBoard(player: Player): number | null {
  if (!inGame(player)) return null;
  const boardId = boardSession(player).boardId;
  if (boardId === null) return null;
  const character = player.character!;
  if (!canReadBoard(player.config, character, boardId)) return null;
  if (!nearBoard(player.map!, character, boardId)) return null;
  return boardId;
}

async function boardOpen(player: Player, reader: EoReader): Promise<void> {
  const packet = BoardOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  const boardId = packet.boardId;
  if (!nearBoard(player.map!, character, boardId)) return;
  if (!canReadBoard(player.config, character, boardId)) return;

  boardSession(player).boardId = boardId;
  await sendBoardListing(player, boardId);
}

async function boardCreate(player: Player, reader: EoReader): Promise<void> {
  const packet = BoardCreateClientPacket.deserialize(reader);
  const boardId = activeBoard(player);
  if (boardId === null) return;
  const character = player.character!;

  await createBoardPost(
    player.server.db,
    player.config,
    boardId,
    { id: character.id, name: character.name },
    packet.postSubject,
    packet.postBody,
  );
  await sendBoardListing(player, boardId);
}

async function boardTake(player: Player, reader: EoReader): Promise<void> {
  const packet = BoardTakeClientPacket.deserialize(reader);
  const boardId = activeBoard(player);
  if (boardId === null) return;
  const postId = boardSession(player).postIds.get(packet.postId);

  const post =
    postId === undefined
      ? undefined
      : await player.server.db
          .selectFrom('board_posts')
          .select(['id', 'body'])
          .where('board_id', '=', boardId)
          .where('id', '=', postId)
          .executeTakeFirst();
  if (!inGame(player)) return;

  const reply = new BoardPlayerServerPacket();
  reply.postId = packet.postId;
  reply.postBody = post?.body ?? '';
  player.bus.send(reply);
}

async function boardRemove(player: Player, reader: EoReader): Promise<void> {
  const packet = BoardRemoveClientPacket.deserialize(reader);
  const boardId = activeBoard(player);
  if (boardId === null) return;
  const character = player.character!;
  const postId = boardSession(player).postIds.get(packet.postId);

  if (postId !== undefined && canDeleteBoardPosts(character)) {
    await player.server.db
      .deleteFrom('board_posts')
      .where('board_id', '=', boardId)
      .where('id', '=', postId)
      .execute();
    log.info({ cat: 'board', admin: character.name, board: boardId, post: postId }, 'board post removed');
  }
  await sendBoardListing(player, boardId);
}

export function handleBoard(player: Player, action: number, reader: EoReader): Promise<void> | void {
  switch (action) {
    case PacketAction.Open:
      return boardOpen(player, reader);
    case PacketAction.Create:
      return boardCreate(player, reader);
    case PacketAction.Take:
      return boardTake(player, reader);
    case PacketAction.Remove:
      return boardRemove(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Board action');
  }
}
