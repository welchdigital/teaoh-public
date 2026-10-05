import { countBans, listBans } from '../account/bans.ts';
import {
  announce,
  banCharacter,
  cancelShutdown,
  deleteCharacter,
  disbandGuild,
  dropGroundItem,
  evacuateMap,
  freeCharacter,
  freezeCharacter,
  giveItem,
  jailCharacter,
  kickCharacter,
  messageCharacter,
  muteCharacter,
  PROPERTY_NAMES,
  quake,
  recordAudit,
  reloadMap,
  removeGroundItem,
  removeItem,
  removeNpc,
  renameCharacter,
  resetPassword,
  saveAll,
  scheduleShutdown,
  setAccountLock,
  setCharacterProperties,
  setGlobalLock,
  setReportResolved,
  spawnNpcs,
  unban,
  unmuteCharacter,
  warpCharacter,
  type AnnounceKind,
  type PropertyChange,
  type PropertyName,
} from './actions.ts';
import { countAudit, listAudit } from './audit.ts';
import { chatLog, serializeChatEvent } from './chat-log.ts';
import { eventLog, serializeLogEvent, type LogQuery } from './event-log.ts';
import {
  HttpError,
  iso,
  optionalBool,
  optionalInt,
  optionalString,
  pageOf,
  pathInt,
  queryBool,
  queryInt,
  requireDuration,
  requireInt,
  requireString,
} from './http.ts';
import { lookupClasses, lookupItems, lookupNpcs, lookupSpells } from './lookups.ts';
import { countMutes, listMutes } from './mutes.ts';
import { isReloadTarget, RELOAD_TARGETS } from './reload-targets.ts';
import { countReports, listReports, type ListReportsOptions } from './reports.ts';
import { Router, type ApiContext } from './router.ts';
import {
  accountDetailView,
  accountsView,
  banView,
  characterDetailView,
  charactersView,
  guildDetailView,
  guildsView,
  mapDetailView,
  mapsView,
  muteView,
  onlinePlayersView,
  reportView,
  slnView,
  statusView,
  type CharacterStatus,
} from './views.ts';

const OK = { ok: true } as const;
const ANNOUNCE_KINDS: readonly AnnounceKind[] = ['announce', 'server', 'admin'];
const MAX_MESSAGE = 200;
const MAX_REASON = 500;
const MAX_NOTE = 1000;
const MAX_SHUTDOWN_SECONDS = 3600;
const MAX_NPC_SPAWN = 20;

const PATCH_FIELDS = new Set<string>(PROPERTY_NAMES);

function characterRef(ctx: ApiContext): { id: number } {
  return { id: pathInt(ctx.params, 'id') };
}

function requireMapExists(ctx: Pick<ApiContext, 'game'>, mapId: number) {
  const map = ctx.game.world.getMap(mapId);
  if (map === undefined) throw new HttpError(404, `map ${mapId} not found`);
  return map;
}

function logQuery(query: URLSearchParams): LogQuery {
  const opts: LogQuery = { limit: queryInt(query, 'limit', 200, 1, 2000) };
  const categories = query.get('categories');
  if (categories !== null && categories.trim() !== '') {
    opts.categories = categories
      .split(',')
      .map((category) => category.trim())
      .filter((category) => category !== '');
  }
  if (query.has('minLevel') && query.get('minLevel') !== '') opts.minLevel = queryInt(query, 'minLevel', 0, 0, 100);
  const search = query.get('search');
  if (search !== null && search !== '') opts.search = search;
  if (query.has('afterSeq') && query.get('afterSeq') !== '') {
    opts.afterSeq = queryInt(query, 'afterSeq', 0, 0, Number.MAX_SAFE_INTEGER);
  }
  return opts;
}

function addServerRoutes(router: Router): void {
  router.get('/api/status', ({ game }) => statusView(game));

  router.post('/api/server/announce', async ({ game, actor, body }) => {
    const message = requireString(body, 'message', { min: 1, max: MAX_MESSAGE });
    const kind = body['kind'] ?? 'announce';
    if (typeof kind !== 'string' || !ANNOUNCE_KINDS.includes(kind as AnnounceKind)) {
      throw new HttpError(400, 'kind must be announce, server or admin');
    }
    await announce(game, actor, kind as AnnounceKind, message);
    return OK;
  });

  router.post('/api/server/global', async ({ game, actor, body }) => {
    const locked = optionalBool(body, 'locked');
    if (locked === undefined) throw new HttpError(400, 'locked must be a boolean');
    return { ok: true, locked: await setGlobalLock(game, actor, locked) };
  });

  router.post('/api/server/quake', async ({ game, actor, body }) => {
    const magnitude = requireInt(body, 'magnitude', { min: 1, max: 8 });
    const mapId = optionalInt(body, 'mapId', { min: 1 });
    if (mapId !== undefined) requireMapExists({ game }, mapId);
    await quake(game, actor, magnitude, mapId);
    return OK;
  });

  router.post('/api/server/save', async ({ game, actor }) => ({ ok: true, saved: await saveAll(game, actor) }));

  router.post('/api/server/shutdown', async ({ game, actor, body }) => {
    const seconds = requireInt(body, 'seconds', { min: 0, max: MAX_SHUTDOWN_SECONDS });
    const message = optionalString(body, 'message', MAX_MESSAGE);
    const plan = await scheduleShutdown(game, actor, seconds, message);
    return { ok: true, at: iso(plan.at) };
  });

  router.delete('/api/server/shutdown', async ({ game, actor }) => {
    await cancelShutdown(game, actor);
    return OK;
  });

  router.post('/api/server/reload', async ({ game, actor, body }) => {
    const target = body['target'];
    if (!isReloadTarget(target)) {
      throw new HttpError(400, `target must be one of ${RELOAD_TARGETS.join(', ')}`);
    }
    let detail: string;
    try {
      detail = await game.reload(target);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await recordAudit(game, actor, 'reload_failed', target, { error });
      throw new HttpError(500, `reload of ${target} failed: ${error}`);
    }
    await recordAudit(game, actor, 'reload', target, { detail });
    return { ok: true, target, detail };
  });

  router.post('/api/sln/ping', async ({ game, actor }) => {
    if (!game.config.sln.enabled) throw new HttpError(409, 'the SLN is disabled ([sln] enabled = false)');
    const status = await game.pingSln();
    await recordAudit(game, actor, 'sln_ping', null, { result: status.lastResult });
    return { ok: true, sln: slnView(status) };
  });

  router.get('/api/players', ({ game }) => onlinePlayersView(game));
}

function addCharacterRoutes(router: Router): void {
  router.get('/api/characters', ({ game, query }) => {
    const status = query.get('status') ?? 'all';
    if (status !== 'all' && status !== 'online' && status !== 'offline') {
      throw new HttpError(400, 'status must be all, online or offline');
    }
    return charactersView(game, query.get('q') ?? '', status as CharacterStatus, pageOf(query));
  });

  router.get('/api/characters/:id', (ctx) => characterDetailView(ctx.game, characterRef(ctx).id));

  router.patch('/api/characters/:id', async (ctx) => {
    const changes: PropertyChange[] = [];
    for (const [key, value] of Object.entries(ctx.body)) {
      if (!PATCH_FIELDS.has(key)) throw new HttpError(400, `unknown field ${key}`);
      if (value === undefined) continue;
      changes.push([key as PropertyName, value]);
    }
    if (changes.length === 0) throw new HttpError(400, 'no fields to update');
    const ref = characterRef(ctx);
    await setCharacterProperties(ctx.game, ctx.actor, ref, changes);
    return characterDetailView(ctx.game, ref.id);
  });

  router.post('/api/characters/:id/items', async (ctx) => {
    const itemId = requireInt(ctx.body, 'itemId', { min: 1 });
    const amount = requireInt(ctx.body, 'amount', { min: 1 });
    const ref = characterRef(ctx);
    await giveItem(ctx.game, ctx.actor, ref, itemId, amount);
    return characterDetailView(ctx.game, ref.id);
  });

  router.delete('/api/characters/:id/items/:itemId', async (ctx) => {
    const itemId = pathInt(ctx.params, 'itemId');
    const rawAmount = ctx.query.get('amount');
    let amount: number | null = null;
    if (rawAmount !== null && rawAmount !== '') {
      if (!/^\d+$/.test(rawAmount) || Number(rawAmount) < 1) throw new HttpError(400, 'amount must be an integer >= 1');
      amount = Number.parseInt(rawAmount, 10);
    }
    const ref = characterRef(ctx);
    await removeItem(ctx.game, ctx.actor, ref, itemId, amount);
    return characterDetailView(ctx.game, ref.id);
  });

  router.post('/api/characters/:id/warp', async (ctx) => {
    const mapId = requireInt(ctx.body, 'map', { min: 1 });
    const x = optionalInt(ctx.body, 'x', { min: 0 });
    const y = optionalInt(ctx.body, 'y', { min: 0 });
    if ((x === undefined) !== (y === undefined)) throw new HttpError(400, 'x and y must be given together');
    await warpCharacter(ctx.game, ctx.actor, characterRef(ctx), mapId, x, y);
    return OK;
  });

  router.post('/api/characters/:id/jail', async (ctx) => {
    await jailCharacter(ctx.game, ctx.actor, characterRef(ctx));
    return OK;
  });

  router.post('/api/characters/:id/free', async (ctx) => {
    await freeCharacter(ctx.game, ctx.actor, characterRef(ctx));
    return OK;
  });

  router.post('/api/characters/:id/freeze', async (ctx) => {
    await freezeCharacter(ctx.game, ctx.actor, characterRef(ctx), true);
    return OK;
  });

  router.delete('/api/characters/:id/freeze', async (ctx) => {
    await freezeCharacter(ctx.game, ctx.actor, characterRef(ctx), false);
    return OK;
  });

  router.post('/api/characters/:id/mute', async (ctx) => {
    const minutes = requireDuration(ctx.body);
    const reason = optionalString(ctx.body, 'reason', MAX_REASON);
    await muteCharacter(ctx.game, ctx.actor, characterRef(ctx), minutes === null ? null : minutes * 60_000, reason);
    return OK;
  });

  router.delete('/api/characters/:id/mute', async (ctx) => {
    await unmuteCharacter(ctx.game, ctx.actor, characterRef(ctx));
    return OK;
  });

  router.post('/api/characters/:id/kick', async (ctx) => {
    await kickCharacter(ctx.game, ctx.actor, characterRef(ctx), optionalBool(ctx.body, 'silent') ?? false);
    return OK;
  });

  router.post('/api/characters/:id/message', async (ctx) => {
    const message = requireString(ctx.body, 'message', { min: 1, max: MAX_MESSAGE });
    await messageCharacter(ctx.game, ctx.actor, characterRef(ctx), message);
    return OK;
  });

  router.post('/api/characters/:id/rename', async (ctx) => {
    const name = requireString(ctx.body, 'name', { min: 1, max: 32 });
    const ref = characterRef(ctx);
    await renameCharacter(ctx.game, ctx.actor, ref.id, name);
    return characterDetailView(ctx.game, ref.id);
  });

  router.delete('/api/characters/:id', async (ctx) => {
    await deleteCharacter(ctx.game, ctx.actor, characterRef(ctx).id);
    return OK;
  });
}

function addAccountRoutes(router: Router): void {
  router.get('/api/accounts', ({ game, query }) => accountsView(game, query.get('q') ?? '', pageOf(query)));

  router.get('/api/accounts/:id', (ctx) => accountDetailView(ctx.game, pathInt(ctx.params, 'id')));

  router.post('/api/accounts/:id/password', async (ctx) => {
    const password = ctx.body['password'];
    if (typeof password !== 'string') throw new HttpError(400, 'password must be a string');
    await resetPassword(ctx.game, ctx.actor, pathInt(ctx.params, 'id'), password);
    return OK;
  });

  router.post('/api/accounts/:id/lock', async (ctx) => {
    const reason = optionalString(ctx.body, 'reason', MAX_REASON);
    await setAccountLock(ctx.game, ctx.actor, pathInt(ctx.params, 'id'), true, reason);
    return OK;
  });

  router.delete('/api/accounts/:id/lock', async (ctx) => {
    await setAccountLock(ctx.game, ctx.actor, pathInt(ctx.params, 'id'), false, null);
    return OK;
  });
}

function addModerationRoutes(router: Router): void {
  router.get('/api/bans', async ({ game, query }) => {
    const active = queryBool(query, 'active');
    const page = pageOf(query);
    const [total, items] = await Promise.all([
      countBans(game.db, { active }),
      listBans(game.db, { active, offset: page.offset, limit: page.limit }),
    ]);
    return { total, items: items.map(banView) };
  });

  router.post('/api/bans', async ({ game, actor, body }) => {
    const characterName = optionalString(body, 'characterName', 32);
    const accountId = optionalInt(body, 'accountId', { min: 1 });
    const ip = optionalString(body, 'ip', 45);
    if (characterName === null && accountId === undefined && ip === null) {
      throw new HttpError(400, 'one of characterName, accountId or ip is required');
    }
    const durationMinutes = requireDuration(body);
    const result = await banCharacter(game, actor, {
      target: characterName === null ? undefined : { name: characterName },
      accountId,
      ip: ip ?? undefined,
      durationMinutes,
      reason: optionalString(body, 'reason', MAX_REASON),
      banIp: optionalBool(body, 'banIp') ?? false,
      banHdid: optionalBool(body, 'banHdid') ?? false,
      force: optionalBool(body, 'force') ?? false,
      silent: optionalBool(body, 'silent') ?? false,
    });
    if (result.ban === null) throw new HttpError(500, 'ban created but could not be read back');
    return banView(result.ban);
  });

  router.delete('/api/bans/:id', async (ctx) => {
    await unban(ctx.game, ctx.actor, pathInt(ctx.params, 'id'));
    return OK;
  });

  router.get('/api/mutes', async ({ game, query }) => {
    const active = queryBool(query, 'active');
    const page = pageOf(query);
    const [total, items] = await Promise.all([
      countMutes(game.db, { active }),
      listMutes(game.db, { active, offset: page.offset, limit: page.limit }),
    ]);
    return { total, items: items.map(muteView) };
  });

  router.get('/api/reports', async ({ game, query }) => {
    const status = query.get('status') ?? 'all';
    if (status !== 'all' && status !== 'open' && status !== 'resolved') {
      throw new HttpError(400, 'status must be open, resolved or all');
    }
    const page = pageOf(query);
    const filter = status as ListReportsOptions['status'];
    const [total, items] = await Promise.all([
      countReports(game.db, filter),
      listReports(game.db, { status: filter, offset: page.offset, limit: page.limit }),
    ]);
    return { total, items: items.map(reportView) };
  });

  router.post('/api/reports/:id/resolve', async (ctx) => {
    const note = optionalString(ctx.body, 'note', MAX_NOTE);
    return reportView(await setReportResolved(ctx.game, ctx.actor, pathInt(ctx.params, 'id'), true, note));
  });

  router.post('/api/reports/:id/reopen', async (ctx) =>
    reportView(await setReportResolved(ctx.game, ctx.actor, pathInt(ctx.params, 'id'), false, null)),
  );

  router.get('/api/audit', async ({ game, query }) => {
    const q = query.get('q') ?? '';
    const page = pageOf(query);
    const [total, items] = await Promise.all([
      countAudit(game.db, q),
      listAudit(game.db, { q, offset: page.offset, limit: page.limit }),
    ]);
    return {
      total,
      items: items.map((entry) => ({
        id: entry.id,
        at: iso(entry.at),
        actorKind: entry.actorKind,
        actor: entry.actor,
        sourceIp: entry.sourceIp,
        action: entry.action,
        target: entry.target,
        details: entry.details,
        keyFingerprint: entry.keyFingerprint,
      })),
    };
  });
}

function addWorldRoutes(router: Router): void {
  router.get('/api/guilds', ({ game, query }) => guildsView(game, query.get('q') ?? ''));
  router.get('/api/guilds/:tag', (ctx) => guildDetailView(ctx.game, ctx.params['tag'] ?? ''));
  router.post('/api/guilds/:tag/disband', async (ctx) => {
    await disbandGuild(ctx.game, ctx.actor, ctx.params['tag'] ?? '');
    return OK;
  });

  router.get('/api/maps', ({ game }) => mapsView(game));
  router.get('/api/maps/:id', (ctx) => mapDetailView(ctx.game, requireMapExists(ctx, pathInt(ctx.params, 'id'))));

  router.post('/api/maps/:id/reload', async (ctx) => {
    await reloadMap(ctx.game, ctx.actor, requireMapExists(ctx, pathInt(ctx.params, 'id')).id);
    return OK;
  });

  router.post('/api/maps/:id/evacuate', async (ctx) => {
    const map = requireMapExists(ctx, pathInt(ctx.params, 'id'));
    const seconds = optionalInt(ctx.body, 'seconds', { min: 0, max: 3600 });
    await evacuateMap(ctx.game, ctx.actor, map.id, seconds, false);
    return OK;
  });

  router.post('/api/maps/:id/npcs', async (ctx) => {
    const map = requireMapExists(ctx, pathInt(ctx.params, 'id'));
    const npcId = requireInt(ctx.body, 'npcId', { min: 1 });
    const x = requireInt(ctx.body, 'x', { min: 0 });
    const y = requireInt(ctx.body, 'y', { min: 0 });
    const amount = optionalInt(ctx.body, 'amount', { min: 1, max: MAX_NPC_SPAWN }) ?? 1;
    const spawned = await spawnNpcs(ctx.game, ctx.actor, map.id, npcId, x, y, amount);
    return { ok: true, spawned };
  });

  router.delete('/api/maps/:id/npcs/:index', async (ctx) => {
    const map = requireMapExists(ctx, pathInt(ctx.params, 'id'));
    await removeNpc(ctx.game, ctx.actor, map.id, pathInt(ctx.params, 'index'));
    return OK;
  });

  router.post('/api/maps/:id/items', async (ctx) => {
    const map = requireMapExists(ctx, pathInt(ctx.params, 'id'));
    const itemId = requireInt(ctx.body, 'itemId', { min: 1 });
    const amount = requireInt(ctx.body, 'amount', { min: 1 });
    const x = requireInt(ctx.body, 'x', { min: 0 });
    const y = requireInt(ctx.body, 'y', { min: 0 });
    await dropGroundItem(ctx.game, ctx.actor, map.id, itemId, amount, x, y);
    return OK;
  });

  router.delete('/api/maps/:id/items/:index', async (ctx) => {
    const map = requireMapExists(ctx, pathInt(ctx.params, 'id'));
    await removeGroundItem(ctx.game, ctx.actor, map.id, pathInt(ctx.params, 'index'));
    return OK;
  });

  router.get('/api/data/items', ({ game, query }) =>
    lookupItems(game.pubData, query.get('q') ?? undefined, queryInt(query, 'limit', 50, 1, 500)),
  );
  router.get('/api/data/npcs', ({ game, query }) =>
    lookupNpcs(game.pubData, query.get('q') ?? undefined, queryInt(query, 'limit', 50, 1, 500)),
  );
  router.get('/api/data/spells', ({ game, query }) =>
    lookupSpells(game.pubData, query.get('q') ?? undefined, queryInt(query, 'limit', 50, 1, 500)),
  );
  router.get('/api/data/classes', ({ game }) => lookupClasses(game.pubData));
}

function addLogRoutes(router: Router): void {
  router.get('/api/logs', ({ query }) => ({
    latestSeq: eventLog.latestSeq(),
    events: eventLog.query(logQuery(query)).map(serializeLogEvent),
  }));

  router.get('/api/logs/categories', () => eventLog.categoryCounts());

  router.get('/api/chat', ({ query }) => {
    const channel = query.get('channel') ?? '';
    const afterSeq =
      query.has('afterSeq') && query.get('afterSeq') !== ''
        ? queryInt(query, 'afterSeq', 0, 0, Number.MAX_SAFE_INTEGER)
        : undefined;
    return {
      latestSeq: chatLog.latestSeq(),
      events: chatLog
        .query({
          channel,
          limit: queryInt(query, 'limit', 200, 1, 2000),
          ...(afterSeq === undefined ? {} : { afterSeq }),
        })
        .map(serializeChatEvent),
    };
  });
}

export function buildRouter(): Router {
  const router = new Router();
  addServerRoutes(router);
  addCharacterRoutes(router);
  addAccountRoutes(router);
  addModerationRoutes(router);
  addWorldRoutes(router);
  addLogRoutes(router);
  return router;
}
