import type { Kysely } from 'kysely';
import { activeBanAccountIds, findActiveBan, listBans, type BanListEntry } from '../account/bans.ts';
import { Character, type EquipmentSlot } from '../character/character.ts';
import { toUtcDate, type DB } from '../db/schema.ts';
import type { SlnStatus } from '../net/sln.ts';
import { ClientState } from '../player/client-state.ts';
import type { Player } from '../player/player.ts';
import { QUEST_FINISHED_STATE } from '../quest/engine.ts';
import type { GameServer } from '../server.ts';
import { SERVER_NAME, SERVER_VERSION } from '../version.ts';
import { getGuildRanks } from '../world/guilds.ts';
import { isPk } from '../world/map/character/attack.ts';
import { isEvacuating } from '../world/map/evacuate.ts';
import type { GameMap } from '../world/map/game-map.ts';
import { getWarp, isWalkable } from '../world/map/tiles.ts';
import { HttpError, iso, type Page } from './http.ts';
import { containsText } from './like.ts';
import { className, itemName, spellName } from './lookups.ts';
import { activeMute, type MuteRecord } from './mutes.ts';
import type { ReportRecord } from './reports.ts';

const EQUIPMENT_ORDER: readonly EquipmentSlot[] = [
  'weapon',
  'shield',
  'armor',
  'hat',
  'boots',
  'gloves',
  'accessory',
  'belt',
  'necklace',
  'ring',
  'ring2',
  'armlet',
  'armlet2',
  'bracer',
  'bracer2',
];

const MAX_JAIL_CELLS = 4096;
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const jailRegions = new WeakMap<GameMap, { emf: object; key: string; cells: Set<number> | null }>();

function jailRegion(map: GameMap, x: number, y: number, freeX: number, freeY: number): Set<number> | null {
  const key = `${x},${y},${freeX},${freeY}`;
  const cached = jailRegions.get(map);
  if (cached !== undefined && cached.emf === map.emf && cached.key === key) return cached.cells;
  const stride = map.emf.width + 1;
  const cells = new Set<number>();
  const queue: Array<readonly [number, number]> = [];
  if (isWalkable(map, x, y)) {
    cells.add(y * stride + x);
    queue.push([x, y]);
  }
  while (queue.length > 0 && cells.size <= MAX_JAIL_CELLS) {
    const [cx, cy] = queue.pop()!;
    if (getWarp(map, cx, cy) !== undefined) continue;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const cell = ny * stride + nx;
      if (cells.has(cell) || !isWalkable(map, nx, ny)) continue;
      cells.add(cell);
      queue.push([nx, ny]);
    }
  }
  const enclosed = queue.length === 0 && cells.size > 0 && !cells.has(freeY * stride + freeX);
  const result = enclosed ? cells : null;
  jailRegions.set(map, { emf: map.emf, key, cells: result });
  return result;
}

export function isJailed(game: Pick<GameServer, 'config' | 'world'>, mapId: number, x: number, y: number): boolean {
  const { jailMap, jailX, jailY } = game.config.world;
  if (mapId !== jailMap) return false;
  const { freeMap, freeX, freeY } = game.config.jail;
  if (freeMap !== jailMap) return true;
  const map = game.world.getMap(jailMap);
  const region = map === undefined ? null : jailRegion(map, jailX, jailY, freeX, freeY);
  if (map !== undefined && region !== null) return region.has(y * (map.emf.width + 1) + x);
  return Math.abs(x - jailX) + Math.abs(y - jailY) < Math.abs(x - freeX) + Math.abs(y - freeY);
}

function dateValue(value: Date | string | null): string | null {
  return value === null ? null : iso(toUtcDate(value));
}

export function inGamePlayers(game: GameServer): Player[] {
  const players: Player[] = [];
  for (const player of game.allPlayers()) {
    if (player.state === ClientState.InGame && player.character !== null) players.push(player);
  }
  return players;
}

export function onlineByCharacterId(game: GameServer): Map<number, Player> {
  const map = new Map<number, Player>();
  for (const player of inGamePlayers(game)) map.set(player.character!.id, player);
  return map;
}

async function accountNames(db: Kysely<DB>, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.selectFrom('accounts').select(['id', 'name']).where('id', 'in', unique).execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function slnView(status: SlnStatus): Record<string, unknown> {
  return {
    enabled: status.enabled,
    lastPingAt: iso(status.lastPingAt),
    lastResult: status.lastResult,
    lastError: status.lastError,
  };
}

export function statusView(game: GameServer): Record<string, unknown> {
  const memory = process.memoryUsage();
  const tick = game.tickStats;
  const shutdown = game.shutdownState;
  const now = Date.now();
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    startedAt: iso(game.startedAt),
    uptimeSeconds: Math.floor((now - game.startedAt) / 1000),
    online: game.playerCount(),
    connections: game.players.size,
    maxPlayers: game.config.server.maxPlayers,
    maps: game.world.mapCount,
    tcpPort: game.tcpPort,
    wsPort: game.wsPort,
    database: game.config.database.driver,
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    tick: {
      rateMs: game.config.world.tickRate,
      avgMs: Math.round(tick.avgMs * 1000) / 1000,
      maxMs: Math.round(tick.maxMs * 1000) / 1000,
    },
    globalChatLocked: game.globalLocked,
    lastSaveAt: iso(game.lastSaveAt),
    shutdown:
      shutdown === null
        ? null
        : {
            at: iso(shutdown.at),
            secondsRemaining: Math.max(0, Math.ceil((shutdown.at - now) / 1000)),
            message: shutdown.message,
          },
    sln: slnView(game.slnStatus),
  };
}

export async function onlinePlayersView(game: GameServer): Promise<unknown[]> {
  const players = inGamePlayers(game);
  const names = await accountNames(
    game.db,
    players.map((player) => player.accountId),
  );
  return players.map((player) => {
    const c = player.character!;
    const map = game.world.getMap(c.mapId);
    return {
      id: c.id,
      playerId: player.id,
      accountId: player.accountId,
      accountName: names.get(player.accountId) ?? null,
      name: c.name,
      level: c.row.level,
      classId: c.row.class,
      className: className(game.pubData, c.row.class),
      adminLevel: c.row.admin_level,
      map: c.mapId,
      mapName: map?.emf.name ?? '',
      x: c.row.x,
      y: c.row.y,
      hp: c.row.hp,
      maxHp: c.maxHp,
      tp: c.row.tp,
      maxTp: c.maxTp,
      hidden: c.row.hidden === 1,
      muted: activeMute(game, c.id) !== null,
      frozen: player.frozen,
      jailed: isJailed(game, c.mapId, c.row.x, c.row.y),
      guildTag: c.guildTag ?? null,
      ip: player.ip,
      connectedAt: iso(player.connectedAt),
    };
  });
}

export type CharacterStatus = 'all' | 'online' | 'offline';

export async function charactersView(
  game: GameServer,
  q: string,
  status: CharacterStatus,
  page: Page,
): Promise<{ total: number; items: unknown[] }> {
  const needle = q.trim().toLowerCase();
  const online = onlineByCharacterId(game);
  const db = game.db;
  const onlineIds = [...online.keys()];

  let query = db
    .selectFrom('characters')
    .leftJoin('accounts', 'accounts.id', 'characters.account_id')
    .leftJoin('guilds', 'guilds.id', 'characters.guild_id');
  if (needle !== '') query = query.where(containsText('characters.name', needle, false));
  if (status === 'online') {
    if (onlineIds.length === 0) return { total: 0, items: [] };
    query = query.where('characters.id', 'in', onlineIds);
  } else if (status === 'offline' && onlineIds.length > 0) {
    query = query.where('characters.id', 'not in', onlineIds);
  }

  const counted = await query.select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirst();
  const rows = await query
    .select([
      'characters.id as id',
      'characters.name as name',
      'characters.account_id as account_id',
      'accounts.name as account_name',
      'characters.level as level',
      'characters.class as class',
      'characters.admin_level as admin_level',
      'characters.map as map',
      'characters.x as x',
      'characters.y as y',
      'guilds.tag as guild_tag',
      'characters.created_at as created_at',
    ])
    .orderBy('characters.name', 'asc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();

  const items = rows.map((row) => {
    const live = online.get(row.id)?.character ?? null;
    const classId = live?.row.class ?? row.class;
    return {
      id: row.id,
      name: row.name,
      accountId: row.account_id,
      accountName: row.account_name,
      level: live?.row.level ?? row.level,
      classId,
      className: className(game.pubData, classId),
      adminLevel: live?.row.admin_level ?? row.admin_level,
      map: live?.mapId ?? row.map,
      x: live?.row.x ?? row.x,
      y: live?.row.y ?? row.y,
      online: live !== null,
      guildTag: live !== null ? live.guildTag : row.guild_tag,
      createdAt: dateValue(row.created_at),
    };
  });
  return { total: Number(counted?.count ?? 0), items };
}

export async function characterDetailView(game: GameServer, characterId: number): Promise<Record<string, unknown>> {
  const player = onlineByCharacterId(game).get(characterId) ?? null;
  let character: Character;
  if (player !== null) {
    character = player.character!;
  } else {
    const loaded = await Character.load(game.db, characterId);
    if (loaded === null) throw new HttpError(404, `character ${characterId} not found`);
    loaded.calculateStats(game.formulas, game.pubData, game.config.combat);
    character = loaded;
  }
  const db = game.db;
  const row = character.row;
  const pub = game.pubData;
  const account = await db
    .selectFrom('accounts')
    .select(['id', 'name', 'last_ip'])
    .where('id', '=', row.account_id)
    .executeTakeFirst();
  const ban = await findActiveBan(db, { accountId: row.account_id });
  const mute = activeMute(game, character.id);
  const map = game.world.getMap(character.mapId);
  const computed = character.computed;

  let guild: Record<string, unknown> | null = null;
  if (row.guild_id !== null) {
    const guildRow = await db
      .selectFrom('guilds')
      .select(['tag', 'name'])
      .where('id', '=', row.guild_id)
      .executeTakeFirst();
    if (guildRow !== undefined) {
      guild = {
        tag: guildRow.tag,
        name: guildRow.name,
        rank: row.guild_rank ?? 0,
        rankName: row.guild_rank_string ?? '',
      };
    }
  }

  const quests = [...character.quests.values()].map((progress) => {
    const quest = game.quests.get(progress.questId);
    const completed = progress.state === QUEST_FINISHED_STATE;
    return {
      id: progress.questId,
      name: quest?.name ?? `quest ${progress.questId}`,
      state: completed ? 'Done' : (quest?.stateList[progress.state]?.name ?? String(progress.state)),
      completed,
    };
  });

  return {
    id: character.id,
    name: character.name,
    online: player !== null,
    playerId: player?.id ?? null,
    ip: player?.ip ?? null,
    accountId: row.account_id,
    accountName: account?.name ?? null,
    title: row.title ?? '',
    home: row.home ?? '',
    partner: row.partner ?? '',
    fiance: row.fiance ?? '',
    gender: row.gender,
    hairStyle: row.hair_style,
    hairColor: row.hair_color,
    skin: row.race,
    classId: row.class,
    className: className(pub, row.class),
    level: row.level,
    experience: row.experience,
    usage: row.usage,
    adminLevel: row.admin_level,
    location: {
      map: character.mapId,
      mapName: map?.emf.name ?? '',
      x: row.x,
      y: row.y,
      direction: row.direction,
    },
    hp: row.hp,
    maxHp: character.maxHp,
    tp: row.tp,
    maxTp: character.maxTp,
    baseStats: {
      str: row.strength,
      int: row.intelligence,
      wis: row.wisdom,
      agi: row.agility,
      con: row.constitution,
      cha: row.charisma,
    },
    secondaryStats:
      player === null
        ? null
        : {
            minDamage: computed.minDamage,
            maxDamage: computed.maxDamage,
            accuracy: computed.accuracy,
            evade: computed.evade,
            armor: computed.armor,
          },
    statPoints: row.stat_points,
    skillPoints: row.skill_points,
    karma: row.karma,
    gold: character.heldAmount(1),
    bankGold: row.gold_bank,
    bankLevel: row.bank_level,
    equipment: EQUIPMENT_ORDER.filter((slot) => row[slot] > 0).map((slot) => ({
      slot,
      id: row[slot],
      name: itemName(pub, row[slot]),
    })),
    inventory: character.items.map((item) => ({ id: item.id, name: itemName(pub, item.id), amount: item.amount })),
    bank: character.bankItems.map((item) => ({ id: item.id, name: itemName(pub, item.id), amount: item.amount })),
    spells: character.spells.map((spell) => ({ id: spell.id, name: spellName(pub, spell.id), level: spell.level })),
    quests,
    guild,
    moderation: {
      muted: mute !== null,
      mutedUntil: mute === null ? null : iso(mute.expiresAt),
      frozen: player?.frozen ?? false,
      jailed: isJailed(game, character.mapId, row.x, row.y),
      banned: ban !== null,
      activeBanId: ban?.id ?? null,
    },
  };
}

export function banView(ban: BanListEntry): Record<string, unknown> {
  return {
    id: ban.id,
    accountId: ban.accountId,
    accountName: ban.accountName,
    characterName: ban.characterName,
    ip: ban.ip,
    hdid: ban.hdid,
    reason: ban.reason,
    bannedBy: ban.bannedBy,
    createdAt: iso(ban.createdAt),
    expiresAt: iso(ban.expiresAt),
    active: ban.active,
    revokedAt: iso(ban.revokedAt),
    revokedBy: ban.revokedBy,
  };
}

export function muteView(mute: MuteRecord): Record<string, unknown> {
  return {
    id: mute.id,
    characterId: mute.characterId,
    characterName: mute.characterName,
    reason: mute.reason,
    mutedBy: mute.mutedBy,
    createdAt: iso(mute.createdAt),
    expiresAt: iso(mute.expiresAt),
    active: mute.active,
  };
}

export function reportView(report: ReportRecord): Record<string, unknown> {
  return {
    id: report.id,
    kind: report.kind,
    reporter: report.reporter,
    reportee: report.reportee,
    message: report.message,
    createdAt: iso(report.createdAt),
    status: report.status,
    resolvedBy: report.resolvedBy,
    resolvedAt: iso(report.resolvedAt),
    note: report.note,
  };
}

export async function accountsView(
  game: GameServer,
  q: string,
  page: Page,
): Promise<{ total: number; items: unknown[] }> {
  const db = game.db;
  const needle = q.trim().toLowerCase();
  let query = db.selectFrom('accounts');
  if (needle !== '') {
    query = query.where((eb) =>
      eb.or([
        containsText('accounts.name', needle),
        containsText('accounts.email', needle),
        eb('accounts.last_ip', '=', needle),
      ]),
    );
  }
  const counted = await query.select(({ fn }) => fn.countAll<number>().as('count')).executeTakeFirst();
  const rows = await query
    .select((eb) => [
      'accounts.id',
      'accounts.name',
      'accounts.email',
      'accounts.real_name',
      'accounts.created_at',
      'accounts.last_login_at',
      'accounts.last_ip',
      'accounts.locked_at',
      eb
        .selectFrom('characters')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .whereRef('characters.account_id', '=', 'accounts.id')
        .as('character_count'),
    ])
    .orderBy('accounts.name', 'asc')
    .limit(page.limit)
    .offset(page.offset)
    .execute();
  const banned = await activeBanAccountIds(
    db,
    rows.map((row) => row.id),
  );
  return {
    total: Number(counted?.count ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      realName: row.real_name,
      createdAt: dateValue(row.created_at),
      lastLoginAt: dateValue(row.last_login_at),
      lastIp: row.last_ip,
      characterCount: Number(row.character_count ?? 0),
      online: game.isLoggedIn(row.id),
      banned: banned.has(row.id),
      locked: row.locked_at !== null,
    })),
  };
}

export async function accountDetailView(game: GameServer, accountId: number): Promise<Record<string, unknown>> {
  const db = game.db;
  const row = await db.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
  if (row === undefined) throw new HttpError(404, `account ${accountId} not found`);
  const online = onlineByCharacterId(game);
  const characters = await db
    .selectFrom('characters')
    .select(['id', 'name', 'level'])
    .where('account_id', '=', accountId)
    .orderBy('id', 'asc')
    .execute();
  const bans = await listBans(db, { accountId, limit: 500 });
  const logins = await db
    .selectFrom('login_history')
    .select(['ip', 'event', 'created_at'])
    .where('account_id', '=', accountId)
    .orderBy('id', 'desc')
    .limit(50)
    .execute();
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    realName: row.real_name,
    location: row.location,
    computer: row.computer,
    hdid: row.hdid,
    createdAt: dateValue(row.created_at),
    lastLoginAt: dateValue(row.last_login_at),
    lastIp: row.last_ip,
    online: game.isLoggedIn(row.id),
    locked: row.locked_at !== null,
    lockReason: row.lock_reason,
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      level: online.get(c.id)?.character?.row.level ?? c.level,
      online: online.has(c.id),
    })),
    bans: bans.map(banView),
    logins: logins.map((login) => ({ ip: login.ip, at: dateValue(login.created_at), event: login.event })),
  };
}

export async function guildsView(game: GameServer, q: string): Promise<unknown[]> {
  const db = game.db;
  const needle = q.trim().toLowerCase();
  let query = db.selectFrom('guilds');
  if (needle !== '') {
    query = query.where((eb) =>
      eb.or([
        containsText('guilds.tag', needle),
        containsText('guilds.name', needle),
      ]),
    );
  }
  const rows = await query
    .select((eb) => [
      'guilds.id',
      'guilds.tag',
      'guilds.name',
      'guilds.bank',
      'guilds.created_at',
      eb
        .selectFrom('characters')
        .select(({ fn }) => fn.countAll<number>().as('n'))
        .whereRef('characters.guild_id', '=', 'guilds.id')
        .as('member_count'),
    ])
    .orderBy('guilds.tag', 'asc')
    .limit(500)
    .execute();
  const onlineCounts = new Map<number, number>();
  for (const player of inGamePlayers(game)) {
    const guildId = player.character!.row.guild_id;
    if (guildId !== null) onlineCounts.set(guildId, (onlineCounts.get(guildId) ?? 0) + 1);
  }
  return rows.map((row) => ({
    id: row.id,
    tag: row.tag,
    name: row.name,
    memberCount: Number(row.member_count ?? 0),
    onlineCount: onlineCounts.get(row.id) ?? 0,
    bank: row.bank,
    createdAt: dateValue(row.created_at),
  }));
}

export async function guildDetailView(game: GameServer, tag: string): Promise<Record<string, unknown>> {
  const db = game.db;
  const guild = await db
    .selectFrom('guilds')
    .selectAll()
    .where(({ eb, fn }) => eb(fn('upper', ['tag']), '=', tag.toUpperCase()))
    .executeTakeFirst();
  if (guild === undefined) throw new HttpError(404, `guild ${tag} not found`);
  const ranks = await getGuildRanks(db, guild.id);
  const online = onlineByCharacterId(game);
  const members = await db
    .selectFrom('characters')
    .select(['id', 'name', 'level', 'guild_rank', 'guild_rank_string'])
    .where('guild_id', '=', guild.id)
    .orderBy('guild_rank', 'asc')
    .orderBy('name', 'asc')
    .execute();
  return {
    id: guild.id,
    tag: guild.tag,
    name: guild.name,
    description: guild.description ?? '',
    bank: guild.bank,
    createdAt: dateValue(guild.created_at),
    ranks,
    members: members.map((member) => {
      const live = online.get(member.id)?.character ?? null;
      const rank = live?.row.guild_rank ?? member.guild_rank ?? ranks.length;
      return {
        characterId: member.id,
        name: member.name,
        rank,
        rankName: live?.row.guild_rank_string ?? member.guild_rank_string ?? ranks[rank - 1] ?? '',
        level: live?.row.level ?? member.level,
        online: live !== null,
      };
    }),
  };
}

export function mapsView(game: GameServer): unknown[] {
  const out: Array<{ id: number } & Record<string, unknown>> = [];
  for (const map of game.world.all) {
    let alive = 0;
    for (const npc of map.npcs.values()) if (npc.alive) alive++;
    out.push({
      id: map.id,
      name: map.emf.name,
      width: map.emf.width,
      height: map.emf.height,
      type: map.emf.type,
      pk: isPk(map),
      players: map.players.size,
      npcsAlive: alive,
      npcsTotal: map.npcs.size,
      items: map.items.size,
      evacuating: isEvacuating(map),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}

export function mapDetailView(game: GameServer, map: GameMap): Record<string, unknown> {
  const pub = game.pubData;
  const tileSpecs: Array<{ x: number; y: number; spec: number }> = [];
  for (const row of map.emf.tileSpecRows) {
    for (const tile of row.tiles) tileSpecs.push({ x: tile.x, y: row.y, spec: tile.tileSpec });
  }
  const warps: Array<Record<string, number>> = [];
  for (const row of map.emf.warpRows) {
    for (const tile of row.tiles) {
      warps.push({
        x: tile.x,
        y: row.y,
        map: tile.warp.destinationMap,
        destX: tile.warp.destinationCoords.x,
        destY: tile.warp.destinationCoords.y,
        door: tile.warp.door,
      });
    }
  }
  const now = Date.now();
  return {
    id: map.id,
    name: map.emf.name,
    width: map.emf.width,
    height: map.emf.height,
    type: map.emf.type,
    pk: isPk(map),
    evacuating: isEvacuating(map),
    tileSpecs,
    warps,
    players: [...map.characters.values()].map((c) => ({
      characterId: c.id,
      name: c.name,
      x: c.row.x,
      y: c.row.y,
      direction: c.direction,
      hidden: c.row.hidden === 1,
      adminLevel: c.row.admin_level,
    })),
    npcs: [...map.npcs.values()].map((npc) => ({
      index: npc.index,
      id: npc.id,
      name: npc.data.name,
      x: npc.x,
      y: npc.y,
      hp: npc.hp,
      maxHp: npc.maxHp,
      alive: npc.alive,
      spawned: !npc.fromSpawn,
    })),
    items: [...map.items.values()].map((item) => ({
      index: item.index,
      id: item.id,
      name: itemName(pub, item.id),
      amount: item.amount,
      x: item.x,
      y: item.y,
    })),
    chests: [...map.chests.values()].map((chest) => ({
      x: chest.x,
      y: chest.y,
      items: chest.items.map((item) => ({ id: item.id, name: itemName(pub, item.id), amount: item.amount })),
      spawns: chest.spawns.map((spawn) => {
        const available = chest.items.some((item) => item.slot === spawn.slot && item.id === spawn.itemId);
        return {
          id: spawn.itemId,
          name: itemName(pub, spawn.itemId),
          amount: spawn.amount,
          spawnMinutes: spawn.spawnTime,
          available,
          secondsRemaining: available
            ? 0
            : Math.max(0, Math.ceil((spawn.spawnTime * 60_000 - (now - spawn.takenAt)) / 1000)),
        };
      }),
    })),
  };
}
