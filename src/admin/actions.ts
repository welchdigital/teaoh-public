import {
  AdminLevel,
  GuildKickServerPacket,
  Item,
  ItemKickServerPacket,
  NpcKilledData,
  NpcSpecServerPacket,
  RecoverListServerPacket,
  RecoverPlayerServerPacket,
  RecoverReplyServerPacket,
  RecoverTargetGroupServerPacket,
  StatSkillPlayerServerPacket,
  TalkAdminServerPacket,
  TalkAnnounceServerPacket,
  TalkServerServerPacket,
  TalkSpecServerPacket,
  TalkTellServerPacket,
  WalkCloseServerPacket,
  WalkOpenServerPacket,
  WarpEffect,
  Coords,
} from 'eolib';
import type { Kysely, Updateable } from 'kysely';
import {
  lockAccount,
  normalizeHdid,
  unlockAccount,
  updatePasswordHash,
  validPasswordLength,
} from '../account/accounts.ts';
import { createBan, getBan, revokeBan, type BanListEntry } from '../account/bans.ts';
import { hashPassword, PASSWORD_VERSION, PasswordBusyError } from '../account/password.ts';
import { Character } from '../character/character.ts';
import { MAX_EXPERIENCE, MAX_ITEM_AMOUNT, MAX_KARMA, MAX_LEVEL, MAX_STAT } from '../constants.ts';
import type { CharactersTable, DB } from '../db/schema.ts';
import { lang } from '../lang.ts';
import { log } from '../log.ts';
import { isLoopback } from '../net/connection-log.ts';
import { addressMatcher, normalizeIp } from '../net/ip.ts';
import type { OutgoingPacket } from '../net/packet-bus.ts';
import { ClientState } from '../player/client-state.ts';
import { cancelTrade } from '../player/handlers/trade.ts';
import type { Player } from '../player/player.ts';
import type { ServerContext } from '../server-context.ts';
import { deleteGuild, ensureGuildLeader, getGuildByTag, guildAnnounce, onlineGuildMembers } from '../world/guilds.ts';
import { toggleHidden } from '../world/map/character/hide.ts';
import { giveItem as giveItemLive } from '../world/map/character/items.ts';
import { startEvacuate, toggleEvacuate } from '../world/map/evacuate.ts';
import type { GameMap } from '../world/map/game-map.ts';
import { dropItemOnGround, MAX_GROUND_AMOUNT, removeItem as removeGroundItemLive } from '../world/map/items.ts';
import { sendBossPing } from '../world/map/npc/kill-replies.ts';
import { adminSpawnNpc } from '../world/map/npc/spawn.ts';
import { isInBounds } from '../world/map/tiles.ts';
import { clampQuakeMagnitude, quakeMap, quakeMaps } from '../world/quake.ts';
import { writeAudit, type ActorKind } from './audit.ts';
import { chatLog } from './chat-log.ts';
import { describeMinutes, MAX_DURATION_MINUTES } from './duration.ts';
import { isClassId, isItemId, isNpcId, itemName, npcName } from './lookups.ts';
import { applyMute, clearMute, logMuteFailure } from './mutes.ts';
import { reopenReport, resolveReport, type ReportRecord } from './reports.ts';
import { databaseOf } from './state.ts';

export interface ShutdownPlan {
  at: number;
  message: string | null;
}

export interface LifecycleHooks {
  saveAll(): Promise<number>;
  scheduleShutdown(seconds: number, message?: string): ShutdownPlan;
  cancelShutdown(): boolean;
  readonly shutdownState: ShutdownPlan | null;
}

export interface Actor {
  kind: ActorKind;
  name: string;
  adminLevel: number;
  sourceIp: string | null;
  player: Player | null;
  keyFingerprint?: string | null | undefined;
}

export const API_ADMIN_LEVEL = AdminLevel.HighGameMaster + 1;
export const MAX_HOME_LENGTH = 32;
export const ADMIN_NPC_SPEED = 3;
export const MAX_ANNOUNCE_LENGTH = 200;

export class ActionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ActionError';
    this.status = status;
  }
}

export interface ActionOutcome {
  message?: string;
}

export type TargetRef = { name: string } | { id: number } | { player: Player };

export interface CharacterTarget {
  id: number;
  name: string;
  accountId: number;
  adminLevel: number;
  player: Player | null;
}

export function apiActor(name: string, sourceIp: string | null, keyFingerprint: string | null = null): Actor {
  return { kind: 'api', name, adminLevel: API_ADMIN_LEVEL, sourceIp, player: null, keyFingerprint };
}

export function playerActor(player: Player): Actor {
  const character = player.character;
  return {
    kind: 'ingame',
    name: character?.name ?? `player ${player.id}`,
    adminLevel: character?.row.admin_level ?? 0,
    sourceIp: safeIp(player),
    player,
  };
}

function safeIp(player: Player): string | null {
  try {
    return player.ip ?? null;
  } catch {
    return null;
  }
}

export function canActOn(
  actor: Pick<Actor, 'kind' | 'name' | 'adminLevel'>,
  target: Pick<CharacterTarget, 'name' | 'adminLevel'>,
): boolean {
  if (actor.kind === 'api') return true;
  if (actor.name === target.name) return true;
  return actor.adminLevel > target.adminLevel;
}

function assertCanAct(actor: Actor, target: CharacterTarget): void {
  if (!canActOn(actor, target)) {
    throw new ActionError(403, `You cannot use that on ${target.name} (equal or higher admin level).`);
  }
}

export function hiddenFrom(actor: Actor, target: CharacterTarget): boolean {
  return target.player?.character?.row.hidden === 1 && !canActOn(actor, target);
}

function assertVisibleOnline(actor: Actor, target: CharacterTarget): void {
  if (hiddenFrom(actor, target)) throw new ActionError(409, `${target.name} is not online.`);
}

export function assertRunning(server: ServerContext): void {
  if ((server as Partial<Pick<ServerContext, 'shuttingDown'>>).shuttingDown === true) {
    throw new ActionError(409, 'The server is shutting down.');
  }
}

function inGamePlayers(server: ServerContext): Player[] {
  const players: Player[] = [];
  for (const player of server.allPlayers()) {
    if (player.state === ClientState.InGame && player.character !== null) players.push(player);
  }
  return players;
}

function targetOf(player: Player): CharacterTarget {
  const character = player.character!;
  return {
    id: character.id,
    name: character.name,
    accountId: character.accountId,
    adminLevel: character.row.admin_level,
    player,
  };
}

export function liveTarget(server: ServerContext, ref: TargetRef): CharacterTarget | null {
  if ('player' in ref) {
    const player = ref.player;
    return player.state === ClientState.InGame && player.character !== null && !player.closed ? targetOf(player) : null;
  }
  const name = 'name' in ref ? ref.name.trim().toLowerCase() : null;
  for (const player of inGamePlayers(server)) {
    const character = player.character!;
    if (name !== null ? character.name === name : character.id === (ref as { id: number }).id) {
      return targetOf(player);
    }
  }
  return null;
}

function requireDb(server: Pick<ServerContext, 'db'>): Kysely<DB> {
  const db = databaseOf(server);
  if (db === null) throw new ActionError(503, 'The database is not available.');
  return db;
}

export async function offlineTarget(server: ServerContext, ref: TargetRef): Promise<CharacterTarget | null> {
  const db = databaseOf(server);
  if (db === null) return null;
  let query = db.selectFrom('characters').select(['id', 'name', 'account_id', 'admin_level']);
  if ('player' in ref) {
    const id = ref.player.character?.id;
    if (id === undefined) return null;
    query = query.where('id', '=', id);
  } else {
    query = 'name' in ref ? query.where('name', '=', ref.name.trim().toLowerCase()) : query.where('id', '=', ref.id);
  }
  const row = await query.executeTakeFirst();
  if (row === undefined) return null;
  return { id: row.id, name: row.name, accountId: row.account_id, adminLevel: row.admin_level, player: null };
}

function describeRef(ref: TargetRef): string {
  if ('player' in ref) return `"${ref.player.character?.name ?? ref.player.id}"`;
  return 'name' in ref ? `"${ref.name}"` : `#${ref.id}`;
}

function notFound(ref: TargetRef): ActionError {
  return new ActionError(404, `Character ${describeRef(ref)} not found.`);
}

async function requireTarget(server: ServerContext, ref: TargetRef): Promise<CharacterTarget> {
  const target = liveTarget(server, ref) ?? (await offlineTarget(server, ref));
  if (target === null) throw notFound(ref);
  return target;
}

async function requireOnlineOrExisting(server: ServerContext, ref: TargetRef): Promise<CharacterTarget> {
  const target = liveTarget(server, ref);
  if (target !== null) return target;
  const offline = await offlineTarget(server, ref);
  if (offline === null) throw notFound(ref);
  throw new ActionError(409, `${offline.name} is not online.`);
}

export function isPending(server: ServerContext, target: Pick<CharacterTarget, 'id' | 'accountId'>): boolean {
  for (const player of server.allPlayers()) {
    if (player.character?.id === target.id) return true;
  }
  const loggedIn = (server as Partial<Pick<ServerContext, 'isLoggedIn'>>).isLoggedIn;
  return typeof loggedIn === 'function' && loggedIn.call(server, target.accountId);
}

function assertOffline(server: ServerContext, target: CharacterTarget): void {
  if (target.player !== null || liveTarget(server, { id: target.id }) !== null) {
    throw new ActionError(409, `${target.name} is online.`);
  }
  if (isPending(server, target)) {
    throw new ActionError(409, `${target.name} is logging in or out; try again in a moment.`);
  }
}

async function updateOffline(
  server: ServerContext,
  target: CharacterTarget,
  values: Updateable<CharactersTable>,
): Promise<void> {
  assertOffline(server, target);
  await requireDb(server).updateTable('characters').set(values).where('id', '=', target.id).execute();
}

async function withOfflineCharacter<T>(
  server: ServerContext,
  target: CharacterTarget,
  edit: (character: Character) => T,
): Promise<T> {
  assertOffline(server, target);
  const db = requireDb(server);
  const character = await Character.load(db, target.id);
  if (character === null) throw new ActionError(404, `Character #${target.id} not found.`);
  const result = edit(character);
  assertOffline(server, target);
  await character.save(db);
  return result;
}

function sendAll(server: ServerContext, packet: OutgoingPacket, filter?: (player: Player) => boolean): void {
  for (const player of inGamePlayers(server)) {
    if (filter !== undefined && !filter(player)) continue;
    try {
      player.bus.send(packet);
    } catch {
      continue;
    }
  }
}

export function broadcastServerMessage(server: ServerContext, message: string): void {
  const packet = new TalkServerServerPacket();
  packet.message = message;
  sendAll(server, packet);
  chatLog.record({ channel: 'server', from: 'Server', message });
}

export function sendTalkServer(player: Player, message: string): void {
  const packet = new TalkServerServerPacket();
  packet.message = message;
  player.bus.send(packet);
}

export function broadcastAdminMessage(server: ServerContext, from: string, message: string): void {
  const packet = new TalkAdminServerPacket();
  packet.playerName = from;
  packet.message = message;
  sendAll(
    server,
    packet,
    (player) => player.character!.name !== from && player.character!.row.admin_level >= AdminLevel.Guardian,
  );
}

export function broadcastAnnouncement(server: ServerContext, from: string, message: string, includeSender: boolean): void {
  const packet = new TalkAnnounceServerPacket();
  packet.playerName = from;
  packet.message = message;
  sendAll(server, packet, (player) => includeSender || player.character!.name !== from);
}

async function audit(
  server: ServerContext,
  actor: Actor,
  action: string,
  target: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await writeAudit(server, {
    actorKind: actor.kind,
    actor: actor.name,
    sourceIp: actor.sourceIp,
    keyFingerprint: actor.keyFingerprint ?? null,
    action,
    target,
    details,
  });
}

export function recordAudit(
  server: ServerContext,
  actor: Actor,
  action: string,
  target: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  return audit(server, actor, action, target, details);
}

export function mapById(server: ServerContext, mapId: number): GameMap | undefined {
  return (server as Partial<Pick<ServerContext, 'world'>>).world?.getMap(mapId);
}

export type MapRef = GameMap | number;

function requireMap(server: ServerContext, ref: MapRef): GameMap {
  if (typeof ref !== 'number') return ref;
  const map = Number.isInteger(ref) ? mapById(server, ref) : undefined;
  if (map === undefined) throw new ActionError(404, `Map ${ref} does not exist.`);
  return map;
}

function assertInBounds(map: GameMap, x: number, y: number): void {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !isInBounds(map, x, y)) {
    throw new ActionError(
      400,
      `Coordinates ${x},${y} are outside map ${map.id} (0-${map.emf.width}, 0-${map.emf.height}).`,
    );
  }
}

export function mapCentre(map: GameMap): { x: number; y: number } {
  return { x: Math.floor(map.emf.width / 2), y: Math.floor(map.emf.height / 2) };
}

function warpLive(server: ServerContext, player: Player, mapId: number, x: number, y: number): void {
  const character = player.character;
  if (character === null) throw new ActionError(409, 'The character is not in game.');
  if (player.isDying) throw new ActionError(409, `${character.name} is respawning; try again in a moment.`);
  if (mapById(server, mapId) === undefined) throw new ActionError(500, `Map ${mapId} does not exist.`);
  player.requestWarp(mapId, x, y, character.mapId === mapId && player.map !== null, WarpEffect.Admin);
}

export async function kickCharacter(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  silent: boolean,
): Promise<ActionOutcome> {
  const target = liveTarget(server, ref) ?? (await requireOnlineOrExisting(server, ref));
  assertVisibleOnline(actor, target);
  assertCanAct(actor, target);
  target.player!.close(`kicked by ${actor.name}`);
  if (!silent) {
    broadcastServerMessage(
      server,
      lang('announce_remove', { victim: target.name, name: actor.name, method: 'kicked' }),
    );
  }
  await audit(server, actor, silent ? 'skick' : 'kick', target.name);
  return silent ? { message: `${target.name} was kicked.` } : {};
}

export interface BanRequest {
  target?: TargetRef | undefined;
  accountId?: number | undefined;
  ip?: string | undefined;
  durationMinutes: number | null;
  reason?: string | null | undefined;
  banIp: boolean;
  banHdid?: boolean | undefined;
  force?: boolean | undefined;
  silent: boolean;
}

export interface BanResult {
  banId: number;
  ban: BanListEntry | null;
  targetName: string | null;
  disconnected: number;
}

function assertDurationMinutes(minutes: number | null): void {
  if (minutes === null) return;
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes > MAX_DURATION_MINUTES) {
    throw new ActionError(400, `Duration must be 1-${MAX_DURATION_MINUTES} minutes, or permanent.`);
  }
}

function protectedIp(server: ServerContext, ip: string): boolean {
  return isLoopback(ip) || addressMatcher(server.config.server.trustedProxies).matches(ip);
}

export async function banCharacter(server: ServerContext, actor: Actor, request: BanRequest): Promise<BanResult> {
  assertRunning(server);
  assertDurationMinutes(request.durationMinutes);
  let explicitIp: string | null = null;
  if (request.ip !== undefined && request.ip.trim() !== '') {
    explicitIp = normalizeIp(request.ip);
    if (explicitIp === null) throw new ActionError(400, `Invalid IP address "${request.ip.trim()}".`);
    if (request.force !== true && protectedIp(server, explicitIp)) {
      throw new ActionError(
        400,
        `Refusing to ban ${explicitIp}: it is a loopback or trusted proxy address (set force to ban it anyway).`,
      );
    }
  }
  const db = requireDb(server);
  let target: CharacterTarget | null = null;
  if (request.target !== undefined) {
    target = await requireTarget(server, request.target);
    assertCanAct(actor, target);
  }

  let accountId: number | null = target?.accountId ?? null;
  if (request.accountId !== undefined) {
    const account = await db
      .selectFrom('accounts')
      .select(['id'])
      .where('id', '=', request.accountId)
      .executeTakeFirst();
    if (account === undefined) throw new ActionError(404, `Account #${request.accountId} not found.`);
    if (accountId !== null && accountId !== account.id) {
      throw new ActionError(400, 'The character does not belong to that account.');
    }
    accountId = account.id;
    if (actor.kind !== 'api') {
      const highest = await db
        .selectFrom('characters')
        .select(({ fn }) => fn.max('admin_level').as('level'))
        .where('account_id', '=', account.id)
        .executeTakeFirst();
      if (Number(highest?.level ?? 0) >= actor.adminLevel) {
        throw new ActionError(403, 'You cannot ban an account with an equal or higher admin.');
      }
    }
  }

  let ip = explicitIp;
  if (request.banIp && ip === null) {
    let derived: string | null = null;
    if (target?.player != null) derived = safeIp(target.player);
    else if (accountId !== null) {
      const account = await db
        .selectFrom('accounts')
        .select(['last_ip'])
        .where('id', '=', accountId)
        .executeTakeFirst();
      derived = account?.last_ip ?? null;
    }
    const normalized = normalizeIp(derived);
    ip = normalized !== null && !protectedIp(server, normalized) ? normalized : null;
  }
  let hdid: string | null = null;
  if (request.banHdid === true && target?.player != null) {
    const normalized = normalizeHdid(target.player.hdid ?? '');
    hdid = normalized === null || normalized === '' ? null : normalized;
  }

  if (accountId === null && ip === null) {
    throw new ActionError(400, 'A ban needs a character, an account or an IP address.');
  }

  let banId: number | null = null;
  let failure: unknown = null;
  try {
    banId = await createBan(db, {
      accountId,
      characterName: target?.name ?? null,
      ip,
      hdid,
      durationMinutes: request.durationMinutes,
      reason: request.reason ?? null,
      bannedBy: actor.name,
    });
  } catch (err) {
    failure = err;
  }

  let disconnected = 0;
  for (const player of [...server.allPlayers()]) {
    if (player === actor.player) continue;
    const matchesAccount = accountId !== null && player.accountId === accountId;
    const matchesIp =
      ip !== null &&
      normalizeIp(safeIp(player)) === ip &&
      (player.character?.row.admin_level ?? 0) < AdminLevel.Guardian;
    const matchesCharacter = target !== null && player.character?.id === target.id;
    if (matchesAccount || matchesIp || matchesCharacter) {
      player.close(`banned by ${actor.name}`);
      disconnected++;
    }
  }

  const victim = target?.name ?? (accountId !== null ? `account #${accountId}` : ip);
  const details = {
    accountId,
    ip,
    durationMinutes: request.durationMinutes,
    reason: request.reason ?? null,
    disconnected,
  };
  if (banId === null) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    log.error({ cat: 'admin', victim, err: reason }, 'ban could not be saved');
    await audit(server, actor, 'ban_failed', victim, { ...details, error: reason });
    throw new ActionError(
      500,
      `The ban could not be saved (${reason}); ${disconnected} connection${disconnected === 1 ? ' was' : 's were'} closed.`,
    );
  }

  if (!request.silent && target !== null) {
    broadcastServerMessage(
      server,
      lang('announce_remove', { victim: target.name, name: actor.name, method: 'banned' }),
    );
  }
  await audit(server, actor, request.silent ? 'sban' : 'ban', victim, { banId, ...details });
  return {
    banId,
    ban: await getBan(db, banId),
    targetName: target?.name ?? null,
    disconnected,
  };
}

export async function unban(server: ServerContext, actor: Actor, banId: number): Promise<void> {
  assertRunning(server);
  const revoked = await revokeBan(requireDb(server), banId, actor.name);
  if (!revoked) throw new ActionError(404, `Active ban #${banId} not found.`);
  await audit(server, actor, 'unban', `ban #${banId}`);
}

export async function jailCharacter(server: ServerContext, actor: Actor, ref: TargetRef): Promise<ActionOutcome> {
  assertRunning(server);
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const { jailMap, jailX, jailY } = server.config.world;
  if (target.player !== null) warpLive(server, target.player, jailMap, jailX, jailY);
  else await updateOffline(server, target, { map: jailMap, x: jailX, y: jailY });
  broadcastServerMessage(
    server,
    lang('announce_remove', { victim: target.name, name: actor.name, method: 'jailed' }),
  );
  await audit(server, actor, 'jail', target.name, { online: target.player !== null });
  return {};
}

export async function freeCharacter(server: ServerContext, actor: Actor, ref: TargetRef): Promise<ActionOutcome> {
  assertRunning(server);
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const { freeMap, freeX, freeY } = server.config.jail;
  if (target.player !== null) warpLive(server, target.player, freeMap, freeX, freeY);
  else await updateOffline(server, target, { map: freeMap, x: freeX, y: freeY });
  await audit(server, actor, 'free', target.name, { online: target.player !== null });
  return { message: `${target.name} has been freed.` };
}

export async function freezeCharacter(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  frozen: boolean,
): Promise<ActionOutcome> {
  const target = liveTarget(server, ref) ?? (await requireOnlineOrExisting(server, ref));
  assertVisibleOnline(actor, target);
  assertCanAct(actor, target);
  const player = target.player!;
  player.frozen = frozen;
  player.bus.send(frozen ? new WalkCloseServerPacket() : new WalkOpenServerPacket());
  broadcastServerMessage(
    server,
    lang(frozen ? 'announce_freeze' : 'announce_unfreeze', { victim: target.name, name: actor.name }),
  );
  await audit(server, actor, frozen ? 'freeze' : 'unfreeze', target.name);
  return {};
}

export async function muteCharacter(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  durationMs: number | null,
  reason: string | null,
): Promise<ActionOutcome> {
  assertRunning(server);
  if (durationMs !== null) {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MINUTES * 60_000) {
      throw new ActionError(400, `Duration must be at most ${MAX_DURATION_MINUTES} minutes, or permanent.`);
    }
  }
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const { saved } = applyMute(server, {
    characterId: target.id,
    characterName: target.name,
    durationMs,
    reason,
    mutedBy: actor.name,
  });
  try {
    await saved;
  } catch (err) {
    logMuteFailure(err, target.name);
    throw new ActionError(500, 'The mute could not be saved.');
  }
  if (target.player !== null) {
    target.player.muted = true;
    const spec = new TalkSpecServerPacket();
    spec.adminName = actor.name;
    target.player.bus.send(spec);
    broadcastServerMessage(server, lang('announce_mute', { victim: target.name, name: actor.name }));
  }
  const minutes = durationMs === null ? null : Math.ceil(durationMs / 60_000);
  await audit(server, actor, 'mute', target.name, { durationMinutes: minutes, reason });
  return target.player === null ? { message: `${target.name} muted ${describeMinutes(minutes)}.` } : {};
}

export async function unmuteCharacter(server: ServerContext, actor: Actor, ref: TargetRef): Promise<ActionOutcome> {
  assertRunning(server);
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const { wasMuted, saved } = clearMute(server, target.id, actor.name);
  if (target.player !== null) target.player.muted = false;
  const revoked = await saved;
  if (!wasMuted && revoked === 0) throw new ActionError(404, `${target.name} is not muted.`);
  await audit(server, actor, 'unmute', target.name);
  return { message: `${target.name} has been unmuted.` };
}

export async function warpCharacter(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  mapId: number,
  x?: number,
  y?: number,
): Promise<ActionOutcome> {
  assertRunning(server);
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const map = requireMap(server, mapId);
  const coords = x === undefined || y === undefined ? mapCentre(map) : { x, y };
  assertInBounds(map, coords.x, coords.y);
  if (target.player !== null) warpLive(server, target.player, map.id, coords.x, coords.y);
  else await updateOffline(server, target, { map: map.id, x: coords.x, y: coords.y });
  await audit(server, actor, 'warp', target.name, { map: map.id, x: coords.x, y: coords.y });
  return {};
}

export function warpPlayerTo(server: ServerContext, player: Player, mapId: number, x: number, y: number): void {
  assertRunning(server);
  warpLive(server, player, mapId, x, y);
}

export const PROPERTY_NAMES = [
  'level',
  'experience',
  'str',
  'int',
  'wis',
  'agi',
  'con',
  'cha',
  'statPoints',
  'skillPoints',
  'karma',
  'classId',
  'adminLevel',
  'title',
  'home',
  'fiance',
  'partner',
  'gender',
  'hairStyle',
  'hairColor',
  'skin',
  'hp',
  'tp',
] as const;

export type PropertyName = (typeof PROPERTY_NAMES)[number];

const PROPERTY_ALIASES: Record<string, PropertyName> = {
  level: 'level',
  lvl: 'level',
  exp: 'experience',
  experience: 'experience',
  str: 'str',
  strength: 'str',
  int: 'int',
  intl: 'int',
  intelligence: 'int',
  wis: 'wis',
  wisdom: 'wis',
  agi: 'agi',
  agility: 'agi',
  con: 'con',
  constitution: 'con',
  cha: 'cha',
  charisma: 'cha',
  statpoints: 'statPoints',
  skillpoints: 'skillPoints',
  karma: 'karma',
  class: 'classId',
  classid: 'classId',
  admin: 'adminLevel',
  adminlevel: 'adminLevel',
  title: 'title',
  home: 'home',
  fiance: 'fiance',
  partner: 'partner',
  gender: 'gender',
  hairstyle: 'hairStyle',
  haircolor: 'hairColor',
  skin: 'skin',
  race: 'skin',
  hp: 'hp',
  tp: 'tp',
};

export function normalizeProperty(name: string): PropertyName | null {
  return PROPERTY_ALIASES[name.trim().toLowerCase()] ?? null;
}

type RowStat = 'strength' | 'intelligence' | 'wisdom' | 'agility' | 'constitution' | 'charisma';
const STAT_COLUMNS: Partial<Record<PropertyName, RowStat>> = {
  str: 'strength',
  int: 'intelligence',
  wis: 'wisdom',
  agi: 'agility',
  con: 'constitution',
  cha: 'charisma',
};

function toInteger(property: string, raw: unknown): number {
  if (typeof raw === 'number') {
    if (Number.isInteger(raw)) return raw;
  } else if (typeof raw === 'string' && /^\s*-?\d+\s*$/.test(raw)) {
    const value = Number.parseInt(raw, 10);
    if (Number.isSafeInteger(value)) return value;
  }
  throw new ActionError(400, `${property} must be a whole number.`);
}

function toText(property: string, raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  throw new ActionError(400, `${property} must be text.`);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseGender(raw: unknown): number {
  if (typeof raw === 'number') {
    if (raw === 0 || raw === 1) return raw;
  } else if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (value === 'male' || value === 'm' || value === '1') return 1;
    if (value === 'female' || value === 'f' || value === '0') return 0;
  }
  throw new ActionError(400, 'gender must be male/m/1 or female/f/0.');
}

export type PropertyChange = readonly [PropertyName, unknown];

interface ApplyContext {
  server: ServerContext;
  actor: Actor;
  target: CharacterTarget;
  character: Character;
}

function validName(server: ServerContext, name: string): boolean {
  const { minNameLength, maxNameLength } = server.config.character;
  return name.length >= minNameLength && name.length <= maxNameLength && /^[a-z]+$/.test(name);
}

function applyProperty(ctx: ApplyContext, property: PropertyName, raw: unknown): void {
  const { server, actor, target, character } = ctx;
  const row = character.row;
  const statColumn = STAT_COLUMNS[property];
  if (statColumn !== undefined) {
    row[statColumn] = clampRange(toInteger(property, raw), 0, MAX_STAT);
    return;
  }
  switch (property) {
    case 'level': {
      const before = row.level;
      row.level = clampRange(toInteger(property, raw), 0, MAX_LEVEL);
      const delta = row.level - before;
      if (delta !== 0) {
        const { statPointsPerLevel, skillPointsPerLevel } = server.config.world;
        row.stat_points = clampRange(row.stat_points + delta * statPointsPerLevel, 0, MAX_STAT);
        row.skill_points = clampRange(row.skill_points + delta * skillPointsPerLevel, 0, MAX_STAT);
      }
      return;
    }
    case 'experience':
      row.experience = clampRange(toInteger(property, raw), 0, MAX_EXPERIENCE);
      return;
    case 'statPoints':
      row.stat_points = clampRange(toInteger(property, raw), 0, MAX_STAT);
      return;
    case 'skillPoints':
      row.skill_points = clampRange(toInteger(property, raw), 0, MAX_STAT);
      return;
    case 'karma':
      row.karma = clampRange(toInteger(property, raw), 0, MAX_KARMA);
      return;
    case 'classId': {
      const classId = toInteger(property, raw);
      if (!isClassId(server.pubData, classId)) throw new ActionError(400, `Class ${classId} does not exist.`);
      row.class = classId;
      return;
    }
    case 'adminLevel': {
      const level = toInteger(property, raw);
      if (level < AdminLevel.Player || level > AdminLevel.HighGameMaster) {
        throw new ActionError(400, 'adminLevel must be 0-5.');
      }
      if (actor.kind === 'ingame') {
        if (actor.name === target.name) throw new ActionError(403, 'You cannot change your own admin level.');
        if (actor.adminLevel !== AdminLevel.HighGameMaster && level >= actor.adminLevel) {
          throw new ActionError(403, 'You can only grant admin levels below your own.');
        }
      }
      row.admin_level = level;
      return;
    }
    case 'title': {
      const title = toText(property, raw);
      const max = server.config.character.maxTitleLength;
      if ([...title].length > max) throw new ActionError(400, `title is longer than ${max} characters.`);
      row.title = title === '' ? null : title;
      return;
    }
    case 'home': {
      const home = toText(property, raw);
      if ([...home].length > MAX_HOME_LENGTH) {
        throw new ActionError(400, `home is longer than ${MAX_HOME_LENGTH} characters.`);
      }
      row.home = home === '' ? null : home;
      return;
    }
    case 'fiance':
    case 'partner': {
      const name = toText(property, raw).toLowerCase();
      if (name !== '' && !validName(server, name)) throw new ActionError(400, `${name} is not a valid name.`);
      row[property] = name === '' ? null : name;
      return;
    }
    case 'gender':
      row.gender = parseGender(raw);
      return;
    case 'hairStyle':
      row.hair_style = clampRange(toInteger(property, raw), 0, server.config.character.maxHairStyle);
      return;
    case 'hairColor':
      row.hair_color = clampRange(toInteger(property, raw), 0, server.config.character.maxHairColor);
      return;
    case 'skin':
      row.race = clampRange(toInteger(property, raw), 0, server.config.character.maxSkin);
      return;
    case 'hp':
      row.hp = clampRange(toInteger(property, raw), 0, MAX_STAT);
      return;
    case 'tp':
      row.tp = clampRange(toInteger(property, raw), 0, MAX_STAT);
      return;
    default:
      throw new ActionError(400, `Unknown property ${String(property)}.`);
  }
}

const STAT_PROPERTIES = new Set<PropertyName>(['level', 'str', 'int', 'wis', 'agi', 'con', 'cha', 'classId']);
const APPEARANCE_PROPERTIES = new Set<PropertyName>(['gender', 'hairStyle', 'hairColor', 'skin', 'adminLevel']);

function pushLiveChanges(ctx: ApplyContext, changed: Set<PropertyName>, levelBefore: number, adminBefore: number): void {
  const { server, target, character } = ctx;
  const player = target.player!;
  const pub = server.pubData;
  const has = (property: PropertyName): boolean => changed.has(property);

  if ([...changed].some((property) => STAT_PROPERTIES.has(property))) {
    const update = new StatSkillPlayerServerPacket();
    update.statPoints = character.row.stat_points;
    update.stats = character.statsUpdate(pub);
    player.bus.send(update);
  }
  if (has('classId')) {
    const list = new RecoverListServerPacket();
    list.classId = character.row.class;
    list.stats = character.statsUpdate(pub);
    player.bus.send(list);
  }
  const levelChanged = has('level') && character.row.level !== levelBefore;
  if (levelChanged || has('experience') || has('karma') || has('level')) {
    const recover = new RecoverReplyServerPacket();
    recover.experience = character.row.experience;
    recover.karma = character.row.karma;
    if (has('level')) {
      recover.levelUp = character.row.level;
      recover.statPoints = character.row.stat_points;
      recover.skillPoints = character.row.skill_points;
    } else {
      recover.levelUp = null;
    }
    player.bus.send(recover);
  }
  if ((has('statPoints') || has('skillPoints')) && !has('level')) {
    const points = new RecoverTargetGroupServerPacket();
    points.statPoints = character.row.stat_points;
    points.skillPoints = character.row.skill_points;
    points.maxHp = character.maxHp;
    points.maxTp = character.maxTp;
    points.maxSp = character.maxSp;
    player.bus.send(points);
  }
  if (has('hp') || has('tp') || [...changed].some((property) => STAT_PROPERTIES.has(property))) {
    const recover = new RecoverPlayerServerPacket();
    recover.hp = character.hp;
    recover.tp = character.tp;
    player.bus.send(recover);
  }
  if (has('adminLevel') && character.row.admin_level !== adminBefore) {
    if (character.row.admin_level < AdminLevel.Guardian && character.row.hidden === 1 && player.map !== null) {
      toggleHidden(player.map, character);
    }
    sendTalkServer(
      player,
      `Your admin level is now ${character.row.admin_level}. Relog for your client to show every change.`,
    );
  }
  if ([...changed].some((property) => APPEARANCE_PROPERTIES.has(property) || property === 'classId')) {
    player.map?.refreshCharacter(player);
  }
}

export interface PropertyResult {
  target: CharacterTarget;
  values: Partial<Record<PropertyName, unknown>>;
}

function readProperty(character: Character, property: PropertyName): unknown {
  const row = character.row;
  const statColumn = STAT_COLUMNS[property];
  if (statColumn !== undefined) return row[statColumn];
  switch (property) {
    case 'level':
      return row.level;
    case 'experience':
      return row.experience;
    case 'statPoints':
      return row.stat_points;
    case 'skillPoints':
      return row.skill_points;
    case 'karma':
      return row.karma;
    case 'classId':
      return row.class;
    case 'adminLevel':
      return row.admin_level;
    case 'title':
      return row.title ?? '';
    case 'home':
      return row.home ?? '';
    case 'fiance':
      return row.fiance ?? '';
    case 'partner':
      return row.partner ?? '';
    case 'gender':
      return row.gender;
    case 'hairStyle':
      return row.hair_style;
    case 'hairColor':
      return row.hair_color;
    case 'skin':
      return row.race;
    case 'hp':
      return row.hp;
    case 'tp':
      return row.tp;
    default:
      return undefined;
  }
}

function applyAll(ctx: ApplyContext, changes: readonly PropertyChange[]): Set<PropertyName> {
  const ordered = [...changes].sort(([a], [b]) => (a === 'level' ? -1 : b === 'level' ? 1 : 0));
  const changed = new Set<PropertyName>();
  const snapshot = { ...ctx.character.row };
  try {
    for (const [property, value] of ordered) {
      applyProperty(ctx, property, value);
      changed.add(property);
    }
  } catch (err) {
    Object.assign(ctx.character.row, snapshot);
    throw err;
  }
  const { server, character } = ctx;
  character.calculateStats(server.formulas, server.pubData, server.config.combat);
  return changed;
}

export async function setCharacterProperties(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  changes: readonly PropertyChange[],
): Promise<PropertyResult> {
  assertRunning(server);
  if (changes.length === 0) throw new ActionError(400, 'No properties to change.');
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  await assertSpousesExist(server, changes);
  const values: Partial<Record<PropertyName, unknown>> = {};
  if (target.player !== null) {
    const character = target.player.character!;
    const ctx: ApplyContext = { server, actor, target, character };
    const levelBefore = character.row.level;
    const adminBefore = character.row.admin_level;
    const changed = applyAll(ctx, changes);
    pushLiveChanges(ctx, changed, levelBefore, adminBefore);
    for (const property of changed) values[property] = readProperty(character, property);
    target.adminLevel = character.row.admin_level;
  } else {
    await withOfflineCharacter(server, target, (character) => {
      const changed = applyAll({ server, actor, target, character }, changes);
      for (const property of changed) values[property] = readProperty(character, property);
    });
  }
  const action = 'adminLevel' in values ? 'set_admin_level' : 'set';
  await audit(server, actor, action, target.name, { changes: Object.fromEntries(changes), values });
  return { target, values };
}

async function assertSpousesExist(server: ServerContext, changes: readonly PropertyChange[]): Promise<void> {
  const db = databaseOf(server);
  for (const [property, raw] of changes) {
    if (property !== 'fiance' && property !== 'partner') continue;
    const name = toText(property, raw).toLowerCase();
    if (name === '' || !validName(server, name) || liveTarget(server, { name }) !== null || db === null) continue;
    const row = await db.selectFrom('characters').select(['id']).where('name', '=', name).executeTakeFirst();
    if (row === undefined) throw new ActionError(400, `${property} ${name} is not an existing character.`);
  }
}

export async function giveItem(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  itemId: number,
  amount: number,
): Promise<number> {
  assertRunning(server);
  if (!isItemId(server.pubData, itemId)) throw new ActionError(400, `Item ${itemId} does not exist.`);
  if (!Number.isInteger(amount) || amount < 1) throw new ActionError(400, 'amount must be a whole number >= 1.');
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  const capped = Math.min(amount, MAX_ITEM_AMOUNT);
  let given: number;
  if (target.player !== null) {
    const player = target.player;
    const character = player.character!;
    const before = character.heldAmount(itemId);
    if (player.map !== null) giveItemLive(player.map, player, character, itemId, capped);
    else character.addItem(itemId, capped);
    given = character.heldAmount(itemId) - before;
  } else {
    given = await withOfflineCharacter(server, target, (character) => {
      const before = character.heldAmount(itemId);
      character.addItem(itemId, capped, false);
      return character.heldAmount(itemId) - before;
    });
  }
  if (given <= 0) throw new ActionError(409, `${target.name} cannot hold any more ${itemName(server.pubData, itemId)}.`);
  await audit(server, actor, 'give_item', target.name, { itemId, amount: given });
  return given;
}

export async function removeItem(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  itemId: number,
  amount: number | null,
): Promise<number> {
  assertRunning(server);
  if (amount !== null && (!Number.isInteger(amount) || amount < 1)) {
    throw new ActionError(400, 'amount must be a whole number >= 1.');
  }
  const target = liveTarget(server, ref) ?? (await requireTarget(server, ref));
  assertCanAct(actor, target);
  let removed: number;
  if (target.player !== null) {
    const player = target.player;
    const character = player.character!;
    const held = character.heldAmount(itemId);
    if (held === 0) throw new ActionError(404, `${target.name} has no item ${itemId}.`);
    if (player.trade !== null) cancelTrade(player, true);
    removed = character.removeItem(itemId, amount ?? held);
    const kick = new ItemKickServerPacket();
    const item = new Item();
    item.id = itemId;
    item.amount = character.heldAmount(itemId);
    kick.item = item;
    kick.currentWeight = character.weight(server.pubData).current;
    player.bus.send(kick);
  } else {
    removed = await withOfflineCharacter(server, target, (character) => {
      const held = character.heldAmount(itemId);
      if (held === 0) throw new ActionError(404, `${target.name} has no item ${itemId}.`);
      return character.removeItem(itemId, amount ?? held, false);
    });
  }
  await audit(server, actor, 'remove_item', target.name, { itemId, amount: removed });
  return removed;
}

export type AnnounceKind = 'announce' | 'server' | 'admin';

export async function announce(
  server: ServerContext,
  actor: Actor,
  kind: AnnounceKind,
  message: string,
): Promise<void> {
  const text = message.trim();
  if (text === '' || [...text].length > MAX_ANNOUNCE_LENGTH) {
    throw new ActionError(400, `message must be 1-${MAX_ANNOUNCE_LENGTH} characters.`);
  }
  const from = actor.kind === 'api' ? 'Server' : actor.name;
  switch (kind) {
    case 'announce':
      broadcastAnnouncement(server, from, text, true);
      chatLog.record({ channel: 'announce', from, message: text });
      break;
    case 'server':
      broadcastServerMessage(server, text);
      break;
    case 'admin':
      broadcastAdminMessage(server, from, text);
      chatLog.record({ channel: 'admin', from, message: text });
      break;
    default:
      throw new ActionError(400, 'kind must be announce, server or admin.');
  }
  await audit(server, actor, 'announce', null, { kind, message: text });
}

export async function setGlobalLock(server: ServerContext, actor: Actor, locked: boolean): Promise<boolean> {
  server.globalLocked = locked;
  broadcastServerMessage(
    server,
    lang('announce_global', { name: actor.name, state: locked ? 'off' : 'on' }),
  );
  await audit(server, actor, 'global', null, { locked });
  return locked;
}

export async function quake(
  server: ServerContext,
  actor: Actor,
  magnitude: number,
  mapId?: number,
): Promise<number> {
  const strength = clampQuakeMagnitude(magnitude);
  let shaken: number;
  if (mapId !== undefined) {
    const map = requireMap(server, mapId);
    quakeMap(map, strength);
    shaken = 1;
  } else {
    shaken = quakeMaps(server.world.all, strength);
  }
  await audit(server, actor, 'quake', mapId === undefined ? null : `map ${mapId}`, { magnitude: strength });
  return shaken;
}

function lifecycle(server: ServerContext): LifecycleHooks {
  const hooks = server as Partial<LifecycleHooks>;
  if (
    typeof hooks.saveAll !== 'function' ||
    typeof hooks.scheduleShutdown !== 'function' ||
    typeof hooks.cancelShutdown !== 'function'
  ) {
    throw new ActionError(501, 'This server does not support that action.');
  }
  return hooks as LifecycleHooks;
}

export async function saveAll(server: ServerContext, actor: Actor): Promise<number> {
  const saved = await lifecycle(server).saveAll();
  await audit(server, actor, 'save', null, { saved });
  return saved;
}

export async function scheduleShutdown(
  server: ServerContext,
  actor: Actor,
  seconds: number,
  message: string | null,
): Promise<ShutdownPlan> {
  const plan = lifecycle(server).scheduleShutdown(seconds, message ?? undefined);
  await audit(server, actor, 'shutdown', null, { seconds, message });
  return plan;
}

export async function cancelShutdown(server: ServerContext, actor: Actor): Promise<void> {
  if (!lifecycle(server).cancelShutdown()) throw new ActionError(404, 'No shutdown is scheduled.');
  await audit(server, actor, 'cancel_shutdown', null);
}

export async function messageCharacter(
  server: ServerContext,
  actor: Actor,
  ref: TargetRef,
  message: string,
): Promise<void> {
  const text = message.trim();
  if (text === '' || [...text].length > MAX_ANNOUNCE_LENGTH) {
    throw new ActionError(400, `message must be 1-${MAX_ANNOUNCE_LENGTH} characters.`);
  }
  const target = liveTarget(server, ref) ?? (await requireOnlineOrExisting(server, ref));
  const packet = new TalkTellServerPacket();
  packet.playerName = 'Server';
  packet.message = text;
  target.player!.bus.send(packet);
  chatLog.record({ channel: 'pm', from: actor.kind === 'api' ? `Server (${actor.name})` : actor.name, to: target.name, message: text });
  await audit(server, actor, 'message', target.name, { message: text });
}

export async function renameCharacter(
  server: ServerContext,
  actor: Actor,
  characterId: number,
  newName: string,
): Promise<CharacterTarget> {
  assertRunning(server);
  const name = newName.trim().toLowerCase();
  if (!validName(server, name)) {
    const { minNameLength, maxNameLength } = server.config.character;
    throw new ActionError(400, `name must be ${minNameLength}-${maxNameLength} letters a-z.`);
  }
  const target = await requireTarget(server, { id: characterId });
  assertCanAct(actor, target);
  assertOffline(server, target);
  const db = requireDb(server);
  const oldName = target.name;
  if (oldName === name) return target;
  const taken = await db.selectFrom('characters').select('id').where('name', '=', name).executeTakeFirst();
  if (taken !== undefined) throw new ActionError(409, `The name ${name} is already taken.`);
  await db.transaction().execute(async (trx) => {
    await trx.updateTable('characters').set({ name }).where('id', '=', characterId).execute();
    await trx.updateTable('characters').set({ partner: name }).where('partner', '=', oldName).execute();
    await trx.updateTable('characters').set({ fiance: name }).where('fiance', '=', oldName).execute();
    await trx.updateTable('mutes').set({ character_name: name }).where('character_id', '=', characterId).execute();
  });
  await audit(server, actor, 'rename', oldName, { name });
  return { ...target, name };
}

export async function deleteCharacter(server: ServerContext, actor: Actor, characterId: number): Promise<void> {
  assertRunning(server);
  const target = await requireTarget(server, { id: characterId });
  assertCanAct(actor, target);
  assertOffline(server, target);
  const db = requireDb(server);
  const row = await db
    .selectFrom('characters')
    .select(['guild_id'])
    .where('id', '=', characterId)
    .executeTakeFirst();
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('characters').where('id', '=', characterId).execute();
    await trx.updateTable('characters').set({ partner: null }).where('partner', '=', target.name).execute();
    await trx.updateTable('characters').set({ fiance: null }).where('fiance', '=', target.name).execute();
  });
  for (const player of server.allPlayers()) {
    const other = player.character;
    if (other === null) continue;
    if (other.row.partner === target.name) other.row.partner = null;
    if (other.row.fiance === target.name) other.row.fiance = null;
  }
  if (row?.guild_id != null) await ensureGuildLeader(server, row.guild_id);
  await audit(server, actor, 'delete_character', target.name, { characterId });
}

function closeAccountPlayers(server: ServerContext, accountId: number, reason: string): number {
  let closed = 0;
  for (const player of [...server.allPlayers()]) {
    if (player.accountId === accountId) {
      player.close(reason);
      closed++;
    }
  }
  return closed;
}

export async function setAccountLock(
  server: ServerContext,
  actor: Actor,
  accountId: number,
  locked: boolean,
  reason: string | null,
): Promise<void> {
  assertRunning(server);
  const db = requireDb(server);
  const ok = locked ? await lockAccount(db, accountId, reason) : await unlockAccount(db, accountId);
  if (!ok) throw new ActionError(404, `Account #${accountId} not found.`);
  if (locked) closeAccountPlayers(server, accountId, `account locked by ${actor.name}`);
  await audit(server, actor, locked ? 'lock_account' : 'unlock_account', `account #${accountId}`, { reason });
}

export async function resetPassword(
  server: ServerContext,
  actor: Actor,
  accountId: number,
  password: string,
): Promise<void> {
  assertRunning(server);
  const limits = server.config.account;
  if (!validPasswordLength(password, limits)) {
    throw new ActionError(400, `password must be ${limits.minPasswordLength}-${limits.maxPasswordLength} characters.`);
  }
  const db = requireDb(server);
  const account = await db.selectFrom('accounts').select(['id', 'name']).where('id', '=', accountId).executeTakeFirst();
  if (account === undefined) throw new ActionError(404, `Account #${accountId} not found.`);
  let hash: string;
  try {
    hash = await hashPassword(account.name, password);
  } catch (err) {
    if (err instanceof PasswordBusyError) {
      throw new ActionError(503, 'Password hashing is busy; try again in a moment.');
    }
    throw err;
  }
  await updatePasswordHash(db, account.id, hash, PASSWORD_VERSION);
  await audit(server, actor, 'reset_password', `account #${accountId}`, { account: account.name });
}

export async function spawnNpcs(
  server: ServerContext,
  actor: Actor,
  mapId: MapRef,
  npcId: number,
  x: number,
  y: number,
  amount: number,
): Promise<number> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  if (!isNpcId(server.pubData, npcId)) throw new ActionError(400, `NPC ${npcId} does not exist.`);
  if (!Number.isInteger(amount) || amount < 1) throw new ActionError(400, 'amount must be a whole number >= 1.');
  assertInBounds(map, x, y);
  let spawned = 0;
  for (let i = 0; i < amount; i++) {
    if (!adminSpawnNpc(map, npcId, x, y, ADMIN_NPC_SPEED)) break;
    spawned++;
  }
  if (spawned === 0) throw new ActionError(409, 'Failed to spawn npc! Index exceeds 252');
  await audit(server, actor, 'spawn_npc', `map ${map.id}`, { npcId, name: npcName(server.pubData, npcId), x, y, spawned });
  return spawned;
}

export async function removeNpc(server: ServerContext, actor: Actor, mapId: MapRef, index: number): Promise<void> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  const npc = map.npcs.get(index);
  if (npc === undefined) throw new ActionError(404, `NPC index ${index} not found on map ${map.id}.`);
  const wasAlive = npc.alive;
  if (wasAlive) {
    const data = new NpcKilledData();
    data.killerId = 0;
    data.killerDirection = 0;
    data.npcIndex = npc.index;
    data.dropIndex = 0;
    data.dropId = 0;
    const coords = new Coords();
    coords.x = npc.x;
    coords.y = npc.y;
    data.dropCoords = coords;
    data.dropAmount = 0;
    data.damage = 0;
    const packet = new NpcSpecServerPacket();
    packet.npcKilledData = data;
    map.broadcastNear(packet, npc.x, npc.y);
  }
  npc.die();
  if (wasAlive && npc.isBoss) sendBossPing(map, npc, true);
  if (!npc.fromSpawn) map.npcs.delete(index);
  await audit(server, actor, 'remove_npc', `map ${map.id}`, { index, npcId: npc.id, name: npc.data.name });
}

export async function dropGroundItem(
  server: ServerContext,
  actor: Actor,
  mapId: MapRef,
  itemId: number,
  amount: number,
  x: number,
  y: number,
): Promise<void> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  if (!isItemId(server.pubData, itemId)) throw new ActionError(400, `Item ${itemId} does not exist.`);
  const maxAmount = Math.min(server.config.limits.maxItem, MAX_GROUND_AMOUNT);
  if (!Number.isInteger(amount) || amount < 1 || amount > maxAmount) {
    throw new ActionError(400, `amount must be 1-${maxAmount} (the largest stack a map tile can hold).`);
  }
  assertInBounds(map, x, y);
  const before = map.items.size;
  dropItemOnGround(map, itemId, amount, x, y);
  if (map.items.size === before) throw new ActionError(409, 'No free ground item slot on that map.');
  await audit(server, actor, 'drop_item', `map ${map.id}`, { itemId, amount, x, y });
}

export async function removeGroundItem(server: ServerContext, actor: Actor, mapId: MapRef, index: number): Promise<void> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  const item = map.items.get(index);
  if (item === undefined) throw new ActionError(404, `Item index ${index} not found on map ${map.id}.`);
  removeGroundItemLive(map, index);
  await audit(server, actor, 'remove_ground_item', `map ${map.id}`, { index, itemId: item.id, amount: item.amount });
}

export async function reloadMap(server: ServerContext, actor: Actor, mapId: MapRef): Promise<void> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  if (!map.reloadFromDisk(server.config.data.dir)) {
    throw new ActionError(500, `Map ${map.id} could not be read from disk.`);
  }
  await audit(server, actor, 'reload_map', `map ${map.id}`);
}

export async function evacuateMap(
  server: ServerContext,
  actor: Actor,
  mapId: MapRef,
  seconds: number | undefined,
  toggle: boolean,
): Promise<boolean> {
  assertRunning(server);
  const map = requireMap(server, mapId);
  let started: boolean;
  if (toggle) started = toggleEvacuate(map, seconds);
  else {
    started = startEvacuate(map, seconds);
    if (!started) throw new ActionError(409, `Map ${map.id} is already being evacuated.`);
  }
  await audit(server, actor, started ? 'evacuate' : 'cancel_evacuate', `map ${map.id}`, {
    seconds: seconds ?? server.config.evacuate.timerSeconds,
  });
  return started;
}

export async function disbandGuild(server: ServerContext, actor: Actor, tag: string): Promise<void> {
  assertRunning(server);
  const db = requireDb(server);
  const guild = await getGuildByTag(db, tag);
  if (guild === undefined) throw new ActionError(404, `Guild ${tag.toUpperCase()} not found.`);
  guildAnnounce(server, guild.id, lang('guild_disbanded', { name: actor.name }));
  const kick = new GuildKickServerPacket();
  for (const member of onlineGuildMembers(server, guild.id)) {
    member.character?.setGuild(null, null, null, null, null);
    member.bus.send(kick);
  }
  await deleteGuild(db, guild.id);
  await audit(server, actor, 'disband_guild', guild.tag, { name: guild.name });
}

export async function setReportResolved(
  server: ServerContext,
  actor: Actor,
  reportId: number,
  resolved: boolean,
  note: string | null,
): Promise<ReportRecord> {
  assertRunning(server);
  const db = requireDb(server);
  const report = resolved ? await resolveReport(db, reportId, actor.name, note) : await reopenReport(db, reportId);
  if (report === null) throw new ActionError(404, `Report #${reportId} not found.`);
  await audit(server, actor, resolved ? 'resolve_report' : 'reopen_report', `report #${reportId}`, { note });
  return report;
}
