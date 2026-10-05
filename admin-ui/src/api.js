import {
  computed,
  getCurrentScope,
  onScopeDispose,
  reactive,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue';

const STORAGE = {
  baseUrl: 'teaoh.admin.baseUrl',
  key: 'teaoh.admin.key',
  actor: 'teaoh.admin.actor',
  keyless: 'teaoh.admin.keyless',
};

function readStorage(name) {
  try {
    return localStorage.getItem(name) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(name, value) {
  try {
    if (value) localStorage.setItem(name, value);
    else localStorage.removeItem(name);
  } catch {
    return;
  }
}

export function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

export function sanitizeActor(name) {
  return String(name || '')
    .replace(/[^\x20-\x7e]/g, '')
    .trim()
    .slice(0, 32);
}

function loadSettings() {
  const key = readStorage(STORAGE.key);
  return {
    baseUrl: normalizeBaseUrl(readStorage(STORAGE.baseUrl)),
    key,
    actor: readStorage(STORAGE.actor),
    keyless: !key && readStorage(STORAGE.keyless) === '1',
  };
}

export const settings = reactive({ ...loadSettings(), version: 0 });

export const configured = computed(() => Boolean(settings.key) || settings.keyless);

function persistSettings() {
  writeStorage(STORAGE.baseUrl, settings.baseUrl);
  writeStorage(STORAGE.key, settings.key);
  writeStorage(STORAGE.actor, settings.actor);
  writeStorage(STORAGE.keyless, settings.keyless ? '1' : '');
}

export function saveSettings({ baseUrl, key, actor, keyless }) {
  const nextBaseUrl = normalizeBaseUrl(baseUrl);
  const nextKey = String(key || '');
  const keepKeyless = keyless ?? (settings.keyless && nextBaseUrl === settings.baseUrl);
  settings.baseUrl = nextBaseUrl;
  settings.key = nextKey;
  settings.actor = sanitizeActor(actor);
  settings.keyless = !nextKey && Boolean(keepKeyless);
  persistSettings();
  settings.version += 1;
  resetConnection();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!Object.values(STORAGE).includes(event.key)) return;
    Object.assign(settings, loadSettings());
    settings.version += 1;
    resetConnection();
  });
}

export class ApiError extends Error {
  constructor(message, status = 0, kind = 'http') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

export const connection = reactive({
  state: 'unknown',
  message: '',
  status: 0,
  since: null,
  retryAt: null,
  retryAfterKnown: false,
});

export const connectionBlocked = computed(
  () => !configured.value || connection.state === 'unauthorized' || connection.state === 'rate-limited',
);

export const connectionSettled = computed(() => !connectionBlocked.value && connection.state !== 'unknown');

let rateLimitTimer = null;

function markConnection(state, error = null, retryAfterMs = 0, retryAfterKnown = false) {
  if (connection.state !== state) connection.since = Date.now();
  connection.state = state;
  connection.message = error ? error.message : '';
  connection.status = error ? error.status : 0;
  clearTimeout(rateLimitTimer);
  connection.retryAt = null;
  connection.retryAfterKnown = false;
  if (state === 'rate-limited') {
    connection.retryAt = Date.now() + retryAfterMs;
    connection.retryAfterKnown = retryAfterKnown;
    rateLimitTimer = setTimeout(() => {
      if (connection.state === 'rate-limited') markConnection('unknown');
    }, retryAfterMs);
  }
}

export function resetConnection() {
  markConnection('unknown');
}

const UNCONFIGURED_MESSAGE = 'No admin key is configured yet. Open Settings to connect.';

export function blockedError() {
  if (!configured.value) return new ApiError(UNCONFIGURED_MESSAGE, 0, 'unconfigured');
  return new ApiError(connection.message || 'Not connected', connection.status, connection.state);
}

export function whenSettled() {
  if (connectionSettled.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(connectionSettled, (ok) => {
      if (!ok) return;
      stop();
      resolve();
    });
  });
}

function describeTarget() {
  return settings.baseUrl ? ` at ${settings.baseUrl}` : '';
}

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
      continue;
    }
    params.set(key, String(value));
  }
  return params.toString();
}

async function readPayload(res) {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { __text: text };
  }
}

export async function request(method, path, { query, body, allowUnconfigured = false } = {}) {
  if (!configured.value && !allowUnconfigured) throw new ApiError(UNCONFIGURED_MESSAGE, 0, 'unconfigured');
  const qs = buildQuery(query);
  const url = `${settings.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  const headers = { accept: 'application/json' };
  if (settings.key) {
    if (/[^\x20-\x7e]/.test(settings.key)) {
      throw new ApiError('The admin key contains characters that cannot be sent in a header.', 0, 'config');
    }
    headers['x-admin-key'] = settings.key;
  }
  const actor = sanitizeActor(settings.actor);
  if (actor) headers['x-admin-actor'] = actor;
  const init = { method, headers, cache: 'no-store' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    if (body !== undefined || method !== 'DELETE') init.body = JSON.stringify(body ?? {});
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch {
    const error = new ApiError(`Cannot reach the admin API${describeTarget()}.`, 0, 'network');
    markConnection('offline', error);
    throw error;
  }

  const payload = await readPayload(res);
  const isText = payload !== null && typeof payload === 'object' && '__text' in payload;

  if (res.ok) {
    if (isText) {
      const error = new ApiError(
        `The server${describeTarget()} did not return JSON. Check the API base URL in Settings.`,
        res.status,
        'network',
      );
      markConnection('offline', error);
      throw error;
    }
    markConnection('ok');
    return payload;
  }

  const serverMessage =
    payload && typeof payload.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : isText && payload.__text.length < 200 && !/</.test(payload.__text)
        ? payload.__text.trim()
        : '';

  if (res.status === 401) {
    const error = new ApiError(
      `Unauthorized${serverMessage && serverMessage.toLowerCase() !== 'unauthorized' ? ` (${serverMessage})` : ''}: the admin key was rejected. Update it in Settings.`,
      401,
      'unauthorized',
    );
    markConnection('unauthorized', error);
    throw error;
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    const known = Number.isFinite(retryAfter) && retryAfter > 0;
    const waitMs = known ? retryAfter * 1000 : 60000;
    const reason = serverMessage || 'too many failed authentication attempts';
    const error = new ApiError(
      `Locked out: ${reason}${/[.!?]$/.test(reason) ? '' : '.'} The banner above shows when to retry.`,
      429,
      'rate-limited',
    );
    markConnection('rate-limited', error, waitMs, known);
    throw error;
  }
  markConnection('ok');
  throw new ApiError(serverMessage || `Request failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`, res.status, 'http');
}

const get = (path, query) => request('GET', path, { query });
const post = (path, body) => request('POST', path, { body });
const patch = (path, body) => request('PATCH', path, { body });
const del = (path, query) => request('DELETE', path, { query });

const seg = (value) => encodeURIComponent(String(value));

export async function testConnection() {
  const status = await request('GET', '/api/status', { allowUnconfigured: true });
  if (!settings.key && !settings.keyless) {
    settings.keyless = true;
    persistSettings();
    settings.version += 1;
  }
  return status;
}

export const MAX_DURATION_MINUTES = 10 * 365 * 24 * 60;

function checkDuration(value) {
  if (value === null) return null;
  if (Number.isInteger(value) && value > 0 && value <= MAX_DURATION_MINUTES) return value;
  throw new ApiError('Duration must be between one minute and 10 years, or permanent.', 400, 'client');
}

function optionalText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

export const api = {
  status: () => get('/api/status'),
  announce: (message, kind) => post('/api/server/announce', { message, kind }),
  setGlobalLock: (locked) => post('/api/server/global', { locked }),
  quake: (magnitude, mapId) =>
    post('/api/server/quake', mapId === null || mapId === undefined ? { magnitude } : { magnitude, mapId }),
  saveAll: () => post('/api/server/save'),
  scheduleShutdown: (seconds, message) =>
    post('/api/server/shutdown', { seconds, message: optionalText(message) }),
  cancelShutdown: () => del('/api/server/shutdown'),
  reload: (target) => post('/api/server/reload', { target }),
  slnPing: () => post('/api/sln/ping'),

  players: () => get('/api/players'),

  characters: ({ q, status, offset, limit } = {}) =>
    get('/api/characters', { q, status, offset, limit }),
  character: (id) => get(`/api/characters/${seg(id)}`),
  updateCharacter: (id, changes) => patch(`/api/characters/${seg(id)}`, changes),
  giveItem: (id, itemId, amount) => post(`/api/characters/${seg(id)}/items`, { itemId, amount }),
  removeItem: (id, itemId, amount) =>
    del(`/api/characters/${seg(id)}/items/${seg(itemId)}`, { amount: amount ?? undefined }),
  warpCharacter: (id, { map, x, y }) =>
    post(`/api/characters/${seg(id)}/warp`, x === null || x === undefined ? { map } : { map, x, y }),
  jailCharacter: (id) => post(`/api/characters/${seg(id)}/jail`),
  freeCharacter: (id) => post(`/api/characters/${seg(id)}/free`),
  freezeCharacter: (id) => post(`/api/characters/${seg(id)}/freeze`),
  unfreezeCharacter: (id) => del(`/api/characters/${seg(id)}/freeze`),
  muteCharacter: (id, { durationMinutes, reason }) =>
    post(`/api/characters/${seg(id)}/mute`, {
      durationMinutes: checkDuration(durationMinutes),
      reason: optionalText(reason),
    }),
  unmuteCharacter: (id) => del(`/api/characters/${seg(id)}/mute`),
  kickCharacter: (id, { silent = false } = {}) => post(`/api/characters/${seg(id)}/kick`, { silent }),
  messageCharacter: (id, message) => post(`/api/characters/${seg(id)}/message`, { message }),
  renameCharacter: (id, name) => post(`/api/characters/${seg(id)}/rename`, { name }),
  deleteCharacter: (id) => del(`/api/characters/${seg(id)}`),

  accounts: ({ q, offset, limit } = {}) => get('/api/accounts', { q, offset, limit }),
  account: (id) => get(`/api/accounts/${seg(id)}`),
  setAccountPassword: (id, password) => post(`/api/accounts/${seg(id)}/password`, { password }),
  lockAccount: (id, reason) => post(`/api/accounts/${seg(id)}/lock`, { reason: optionalText(reason) }),
  unlockAccount: (id) => del(`/api/accounts/${seg(id)}/lock`),

  bans: ({ active, offset, limit } = {}) =>
    get('/api/bans', { active: active === 'all' ? undefined : active, offset, limit }),
  createBan: ({ characterName, accountId, ip, durationMinutes, reason, banIp, banHdid, silent, force }) =>
    post('/api/bans', {
      characterName: optionalText(characterName),
      accountId: accountId ?? undefined,
      ip: optionalText(ip),
      durationMinutes: checkDuration(durationMinutes),
      reason: optionalText(reason),
      banIp: banIp || undefined,
      banHdid: banHdid || undefined,
      silent: silent || undefined,
      force: force || undefined,
    }),
  revokeBan: (id) => del(`/api/bans/${seg(id)}`),

  mutes: ({ active, offset, limit } = {}) =>
    get('/api/mutes', { active: active === 'all' ? undefined : active, offset, limit }),

  reports: ({ status, offset, limit } = {}) => get('/api/reports', { status, offset, limit }),
  resolveReport: (id, note) => post(`/api/reports/${seg(id)}/resolve`, { note: optionalText(note) }),
  reopenReport: (id) => post(`/api/reports/${seg(id)}/reopen`),

  guilds: (q) => get('/api/guilds', { q }),
  guild: (tag) => get(`/api/guilds/${seg(tag)}`),
  disbandGuild: (tag) => post(`/api/guilds/${seg(tag)}/disband`),

  maps: () => get('/api/maps'),
  map: (id) => get(`/api/maps/${seg(id)}`),
  reloadMap: (id) => post(`/api/maps/${seg(id)}/reload`),
  evacuateMap: (id, seconds) =>
    post(`/api/maps/${seg(id)}/evacuate`, seconds === null || seconds === undefined ? {} : { seconds }),
  spawnNpc: (id, { npcId, x, y, amount }) => post(`/api/maps/${seg(id)}/npcs`, { npcId, x, y, amount }),
  removeNpc: (id, index) => del(`/api/maps/${seg(id)}/npcs/${seg(index)}`),
  dropItem: (id, { itemId, amount, x, y }) => post(`/api/maps/${seg(id)}/items`, { itemId, amount, x, y }),
  removeMapItem: (id, index) => del(`/api/maps/${seg(id)}/items/${seg(index)}`),

  dataItems: ({ q, limit } = {}) => get('/api/data/items', { q, limit }),
  dataNpcs: ({ q, limit } = {}) => get('/api/data/npcs', { q, limit }),
  dataSpells: ({ q, limit } = {}) => get('/api/data/spells', { q, limit }),
  dataClasses: () => get('/api/data/classes'),

  logs: ({ categories, minLevel, search, afterSeq, limit } = {}) =>
    get('/api/logs', { categories, minLevel, search, afterSeq, limit }),
  logCategories: () => get('/api/logs/categories'),
  chat: ({ channel, afterSeq, limit } = {}) => get('/api/chat', { channel, afterSeq, limit }),
  audit: ({ q, offset, limit } = {}) => get('/api/audit', { q, offset, limit }),
};

function pageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function onDispose(fn) {
  if (getCurrentScope()) onScopeDispose(fn);
}

function useGate(probe) {
  return computed(() => connectionBlocked.value || (!probe && connection.state === 'unknown'));
}

export function usePolling(fetcher, options = {}) {
  const { interval = 5000, params, enabled = true, immediate = true, resetOnChange = false, probe = false } = options;
  const gated = useGate(probe);
  const data = shallowRef(null);
  const error = shallowRef(null);
  const loading = ref(false);
  const updatedAt = ref(null);
  const currentParams = computed(() => (params === undefined ? undefined : toValue(params)));
  const paramsKey = computed(() => JSON.stringify(currentParams.value ?? null));
  const isEnabled = computed(() => toValue(enabled) !== false);

  let timer = null;
  let inflight = null;
  let queued = null;
  let generation = 0;
  let alive = true;

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clear();
    const ms = toValue(interval);
    if (!alive || !ms || !isEnabled.value || pageHidden()) return;
    timer = setTimeout(tick, ms);
  }

  function tick() {
    timer = null;
    if (gated.value) {
      if (connectionBlocked.value && data.value === null) error.value = blockedError();
      return;
    }
    run();
  }

  function run() {
    if (inflight) return inflight;
    clear();
    const gen = generation;
    loading.value = true;
    inflight = Promise.resolve()
      .then(() => fetcher(currentParams.value))
      .then(
        (result) => {
          if (!alive || gen !== generation) return;
          data.value = result;
          error.value = null;
          updatedAt.value = Date.now();
        },
        (err) => {
          if (!alive || gen !== generation) return;
          error.value = err;
        },
      )
      .finally(() => {
        inflight = null;
        loading.value = false;
        if (!queued) schedule();
      });
    return inflight;
  }

  function refresh() {
    if (!inflight) return run();
    generation += 1;
    if (!queued) {
      queued = inflight.then(() => {
        queued = null;
        return run();
      });
    }
    return queued;
  }

  function mutate(value) {
    generation += 1;
    data.value = value;
    error.value = null;
    updatedAt.value = Date.now();
  }

  function onVisibility() {
    if (!alive) return;
    if (pageHidden()) clear();
    else if (isEnabled.value && !inflight && !gated.value) run();
  }

  watch(paramsKey, () => {
    if (resetOnChange) {
      generation += 1;
      data.value = null;
      error.value = null;
    }
    if (isEnabled.value && !gated.value) refresh();
  });

  watch(isEnabled, (on) => {
    if (on && !gated.value) refresh();
    else if (!on) clear();
  });

  watch(gated, (closed) => {
    if (!closed && alive && isEnabled.value && !pageHidden() && !inflight) run();
  });

  watch(connectionBlocked, (blocked) => {
    if (blocked && data.value === null) error.value = blockedError();
  });

  watch(
    () => settings.version,
    () => {
      if (isEnabled.value && !gated.value) refresh();
    },
  );

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  onDispose(() => {
    alive = false;
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });

  if (immediate && isEnabled.value) {
    if (connectionBlocked.value) error.value = blockedError();
    else if (!gated.value) run();
  }

  return { data, error, loading, updatedAt, refresh, mutate };
}

export function useTail(fetcher, options = {}) {
  const { interval = 2000, limit = 500, max = 2000, params, paused = false } = options;
  const events = shallowRef([]);
  const error = shallowRef(null);
  const loading = ref(false);
  const ready = ref(false);
  const cursorRef = ref(null);
  const isPaused = computed(() => toValue(paused) === true);
  const paramsKey = computed(() => JSON.stringify(toValue(params) ?? null));
  const gated = useGate(false);

  let cursor = null;
  let generation = 0;
  let running = false;
  let pendingReset = false;
  let timer = null;
  let alive = true;

  function clear() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clear();
    if (!alive || isPaused.value || pageHidden() || !interval) return;
    timer = setTimeout(() => {
      timer = null;
      if (gated.value) {
        if (connectionBlocked.value && !ready.value) error.value = blockedError();
        return;
      }
      poll();
    }, interval);
  }

  function append(incoming) {
    if (!incoming.length) return;
    const merged = events.value.concat(incoming);
    events.value = merged.length > max ? merged.slice(merged.length - max) : merged;
  }

  async function poll() {
    if (running) return;
    running = true;
    clear();
    const gen = generation;
    loading.value = true;
    try {
      for (let round = 0; round < 10; round += 1) {
        const initial = cursor === null;
        const query = { ...(toValue(params) || {}), limit };
        if (!initial) query.afterSeq = cursor;
        const res = await fetcher(query);
        if (!alive || gen !== generation) break;
        const incoming = Array.isArray(res?.events) ? res.events : [];
        const latest = Number(res?.latestSeq);
        const hasLatest = Number.isFinite(latest);
        if (!initial && hasLatest && latest < cursor) {
          cursor = null;
          events.value = [];
          continue;
        }
        const lastSeq = incoming.length ? Number(incoming[incoming.length - 1].seq) : null;
        if (initial) {
          events.value = incoming.length > max ? incoming.slice(incoming.length - max) : incoming;
          cursor = hasLatest ? Math.max(latest, lastSeq ?? 0) : (lastSeq ?? 0);
        } else {
          append(incoming);
          if (incoming.length >= limit) cursor = lastSeq ?? cursor;
          else cursor = hasLatest ? Math.max(latest, lastSeq ?? cursor) : (lastSeq ?? cursor);
        }
        cursorRef.value = cursor;
        error.value = null;
        ready.value = true;
        if (initial || incoming.length < limit) break;
      }
    } catch (err) {
      if (alive && gen === generation) error.value = err;
    } finally {
      running = false;
      loading.value = false;
      if (pendingReset) {
        pendingReset = false;
        poll();
      } else {
        schedule();
      }
    }
  }

  function reset() {
    generation += 1;
    cursor = null;
    cursorRef.value = null;
    events.value = [];
    ready.value = false;
    error.value = null;
    if (running) pendingReset = true;
    else if (!gated.value) poll();
    else if (connectionBlocked.value) error.value = blockedError();
  }

  function clearEvents() {
    events.value = [];
  }

  function onVisibility() {
    if (!alive) return;
    if (pageHidden()) clear();
    else if (!isPaused.value && !running && !gated.value) poll();
  }

  watch(paramsKey, reset);
  watch(isPaused, (p) => {
    if (p) clear();
    else if (!running && !gated.value) poll();
  });
  watch(gated, (closed) => {
    if (!closed && alive && !isPaused.value && !running && !pageHidden()) poll();
  });
  watch(connectionBlocked, (blocked) => {
    if (blocked && !ready.value) error.value = blockedError();
  });
  watch(() => settings.version, reset);

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  onDispose(() => {
    alive = false;
    clear();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  });

  if (connectionBlocked.value) error.value = blockedError();
  else if (!gated.value) poll();

  return { events, error, loading, ready, cursor: cursorRef, refresh: poll, reset, clear: clearEvents };
}
