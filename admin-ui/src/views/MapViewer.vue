<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, usePolling } from '../api.js';
import ItemPicker from '../components/ItemPicker.vue';
import Modal from '../components/Modal.vue';
import NpcPicker from '../components/NpcPicker.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAction } from '../composables/useAction.js';
import { usePageTitle } from '../composables/usePageTitle.js';
import { formatNumber, formatTime, toInt } from '../util.js';

const route = useRoute();
const router = useRouter();

const SPEC_COLORS = {
  0: '#3a4048', 18: '#3a4048', 19: '#454b54',
  1: '#6b5637', 2: '#6b5637', 3: '#6b5637', 4: '#6b5637', 5: '#6b5637', 6: '#6b5637', 7: '#6b5637',
  9: '#c8a032', 16: '#2f8f8f', 17: '#2a3038',
  20: '#7c5cd0', 21: '#7c5cd0', 22: '#7c5cd0', 23: '#7c5cd0', 24: '#7c5cd0', 25: '#7c5cd0', 26: '#7c5cd0', 27: '#7c5cd0',
  28: '#d06cae', 29: '#d08a3c', 30: '#2a5db0', 32: '#4a5a7a',
  34: '#b03030', 35: '#c83a3a', 36: '#7a2020',
};

const SPEC_NAMES = {
  0: 'Wall', 1: 'Chair (down)', 2: 'Chair (left)', 3: 'Chair (right)', 4: 'Chair (up)',
  5: 'Chair (down-right)', 6: 'Chair (up-left)', 7: 'Chair (any)', 9: 'Chest', 16: 'Bank vault',
  17: 'NPC boundary', 18: 'Map edge', 19: 'Fake wall', 28: 'Jukebox', 29: 'Jump', 30: 'Water',
  32: 'Arena', 33: 'Ambient sound', 34: 'Timed spikes', 35: 'Spikes', 36: 'Hidden spikes',
};

function specName(spec) {
  if (spec >= 20 && spec <= 27) return `Board ${spec - 19}`;
  return SPEC_NAMES[spec] || `Spec ${spec}`;
}

const LEGEND = [
  { label: 'Player', style: { background: '#3fb950', borderRadius: '50%' } },
  { label: 'Hidden admin', style: { background: '#a371f7', borderRadius: '50%' } },
  { label: 'NPC', style: { background: '#f05561', borderRadius: '50%' } },
  { label: 'Admin-spawned NPC', style: { background: '#ff8c3a', borderRadius: '50%', boxShadow: '0 0 0 1px #fff inset' } },
  { label: 'Ground item', style: { background: '#e8c547', transform: 'rotate(45deg) scale(0.7)' } },
  { label: 'Warp', style: { border: '1px solid #4c8dff' } },
  { label: 'Wall / edge', style: { background: '#3a4048' } },
  { label: 'Water', style: { background: '#2a5db0' } },
  { label: 'Chest', style: { background: '#c8a032' } },
  { label: 'Board', style: { background: '#7c5cd0' } },
  { label: 'Spikes', style: { background: '#c83a3a' } },
  { label: 'Chair', style: { background: '#6b5637' } },
];

const list = usePolling(() => api.maps(), { interval: 10000 });
const listFilter = ref('');
const populatedOnly = ref(false);

const maps = computed(() => (Array.isArray(list.data.value) ? [...list.data.value].sort((a, b) => a.id - b.id) : []));
const filteredMaps = computed(() => {
  const q = listFilter.value.trim().toLowerCase();
  return maps.value.filter((m) => {
    if (populatedOnly.value && !(m.players > 0)) return false;
    if (!q) return true;
    return String(m.id) === q || (m.name || '').toLowerCase().includes(q);
  });
});

const selectedId = computed(() => {
  const raw = Array.isArray(route.query.id) ? route.query.id[0] : route.query.id;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
});

watch(
  [maps, selectedId],
  ([all, id]) => {
    if (id === null && all.length && route.name === 'maps') {
      router.replace({ query: { ...route.query, id: String(all[0].id) } });
    }
  },
  { immediate: true },
);

function selectMap(id) {
  if (id === selectedId.value) return;
  router.push({ query: { ...route.query, id: String(id) } });
}

const detailPoll = usePolling((id) => api.map(id), {
  params: selectedId,
  interval: 2500,
  resetOnChange: true,
  enabled: () => selectedId.value !== null,
});
const detail = detailPoll.data;
const notFound = computed(() => !detail.value && detailPoll.error.value && detailPoll.error.value.status === 404);

const evacuating = computed(() => {
  if (detail.value && detail.value.evacuating) return true;
  const entry = maps.value.find((m) => m.id === selectedId.value);
  return Boolean(entry && entry.evacuating);
});

usePageTitle(() => (detail.value ? `${detail.value.name || 'Map'} #${detail.value.id} · Map viewer` : ''));

const selected = ref(null);
const hover = ref(null);
const tooltip = ref(null);

watch(selectedId, () => {
  selected.value = null;
  hover.value = null;
  tooltip.value = null;
});

function key(x, y) {
  return `${x},${y}`;
}

function group(items) {
  const out = new Map();
  for (const item of items || []) {
    const k = key(item.x, item.y);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}

const index = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return {
    players: group(d.players),
    npcs: group(d.npcs),
    items: group(d.items),
    chests: group(d.chests),
    warps: group(d.warps),
    specs: group(d.tileSpecs),
  };
});

function entitiesAt(x, y) {
  const idx = index.value;
  if (!idx) return null;
  const k = key(x, y);
  return {
    players: idx.players.get(k) || [],
    npcs: idx.npcs.get(k) || [],
    items: idx.items.get(k) || [],
    chest: (idx.chests.get(k) || [])[0] || null,
    warp: (idx.warps.get(k) || [])[0] || null,
    specs: idx.specs.get(k) || [],
  };
}

const here = computed(() => (selected.value ? entitiesAt(selected.value.x, selected.value.y) : null));

const counts = computed(() => {
  const d = detail.value;
  if (!d) return null;
  const npcs = d.npcs || [];
  return {
    players: (d.players || []).length,
    npcsAlive: npcs.filter((n) => n.alive !== false).length,
    npcsTotal: npcs.length,
    spawned: npcs.filter((n) => n.spawned).length,
    items: (d.items || []).length,
    chests: (d.chests || []).length,
  };
});

const ZOOMS = ['fit', 6, 8, 12, 16, 20, 24];
const zoom = ref('fit');
const wrap = ref(null);
const wrapWidth = ref(800);
const canvas = ref(null);
let observer = null;

const cellSize = computed(() => {
  const d = detail.value;
  if (!d) return 12;
  if (zoom.value !== 'fit') return Number(zoom.value);
  const cols = d.width + 1;
  return Math.max(3, Math.min(24, Math.floor((wrapWidth.value - 2) / cols)));
});

function draw() {
  const d = detail.value;
  const cv = canvas.value;
  if (!d || !cv) return;
  const cs = cellSize.value;
  const cols = d.width + 1;
  const rows = d.height + 1;
  const width = cols * cs;
  const height = rows * cs;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  cv.style.width = `${width}px`;
  cv.style.height = `${height}px`;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#12161c';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#171d25';
  for (let y = 0; y < rows; y += 1) {
    for (let x = (y % 2); x < cols; x += 2) ctx.fillRect(x * cs, y * cs, cs, cs);
  }

  for (const t of d.tileSpecs || []) {
    const color = SPEC_COLORS[t.spec];
    if (!color) continue;
    ctx.fillStyle = color;
    ctx.fillRect(t.x * cs, t.y * cs, cs, cs);
  }

  ctx.lineWidth = 1;
  for (const w of d.warps || []) {
    ctx.strokeStyle = w.door ? '#9cc0ffcc' : '#4c8dff99';
    ctx.strokeRect(w.x * cs + 0.5, w.y * cs + 0.5, cs - 1, cs - 1);
  }

  if (cs >= 8) {
    ctx.fillStyle = '#6b4e12';
    for (const c of d.chests || []) ctx.fillRect(c.x * cs + cs * 0.28, c.y * cs + cs * 0.42, cs * 0.44, cs * 0.16);
  }

  ctx.fillStyle = '#e8c547';
  for (const it of d.items || []) {
    const cx = it.x * cs + cs / 2;
    const cy = it.y * cs + cs / 2;
    const r = Math.max(1.5, cs * 0.24);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  }

  for (const n of d.npcs || []) {
    if (n.alive === false) continue;
    const cx = n.x * cs + cs / 2;
    const cy = n.y * cs + cs / 2;
    ctx.fillStyle = n.spawned ? '#ff8c3a' : '#f05561';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, cs / 2.6), 0, Math.PI * 2);
    ctx.fill();
    if (n.spawned && cs >= 6) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  for (const p of d.players || []) {
    ctx.fillStyle = p.hidden ? '#a371f7' : '#3fb950';
    ctx.beginPath();
    ctx.arc(p.x * cs + cs / 2, p.y * cs + cs / 2, Math.max(2.5, cs / 2.3), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.adminLevel > 0 ? '#d5a021' : '#0e1116';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (hover.value) {
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 1;
    ctx.strokeRect(hover.value.x * cs + 0.5, hover.value.y * cs + 0.5, cs - 1, cs - 1);
  }
  if (selected.value) {
    ctx.strokeStyle = '#4c8dff';
    ctx.lineWidth = 2;
    ctx.strokeRect(selected.value.x * cs + 1, selected.value.y * cs + 1, cs - 2, cs - 2);
  }
}

watch([detail, cellSize, selected, hover], draw, { flush: 'post' });

function tileFromEvent(evt) {
  const d = detail.value;
  if (!d || !canvas.value) return null;
  const rect = canvas.value.getBoundingClientRect();
  const cols = d.width + 1;
  const rows = d.height + 1;
  const x = Math.floor(((evt.clientX - rect.left) / rect.width) * cols);
  const y = Math.floor(((evt.clientY - rect.top) / rect.height) * rows);
  if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
  return { x, y };
}

function formatTimer(sec) {
  if (sec <= 0) return 'ready';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function tooltipLines(x, y) {
  const e = entitiesAt(x, y);
  if (!e) return [];
  const lines = [];
  for (const p of e.players) lines.push(`${p.name} (player)${p.hidden ? ' · hidden' : ''}`);
  for (const n of e.npcs) lines.push(`${n.name} (npc #${n.index}) ${n.hp}/${n.maxHp}${n.spawned ? ' · spawned' : ''}${n.alive === false ? ' · dead' : ''}`);
  for (const it of e.items) lines.push(`${it.name} ×${formatNumber(it.amount)} (ground)`);
  if (e.chest) {
    lines.push('Chest');
    for (const s of e.chest.spawns || []) {
      lines.push(`  ${s.name} ×${s.amount}: ${s.available ? 'available' : `respawns in ${formatTimer(s.secondsRemaining)}`}`);
    }
  }
  if (e.warp) lines.push(`Warp → map ${e.warp.map} (${e.warp.destX}, ${e.warp.destY})${e.warp.door ? ' · door' : ''}`);
  if (!lines.length && e.specs.length) lines.push(e.specs.map((s) => specName(s.spec)).join(', '));
  return lines;
}

function onMove(evt) {
  const tile = tileFromEvent(evt);
  if (!tile) {
    hover.value = null;
    tooltip.value = null;
    return;
  }
  if (!hover.value || hover.value.x !== tile.x || hover.value.y !== tile.y) hover.value = tile;
  const lines = tooltipLines(tile.x, tile.y);
  tooltip.value = {
    x: evt.clientX,
    y: evt.clientY,
    text: [`(${tile.x}, ${tile.y})`, ...lines].join('\n'),
  };
}

function onLeave() {
  hover.value = null;
  tooltip.value = null;
}

function onClick(evt) {
  const tile = tileFromEvent(evt);
  if (!tile) return;
  if (selected.value && selected.value.x === tile.x && selected.value.y === tile.y) selected.value = null;
  else selected.value = tile;
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && wrap.value) {
    observer = new ResizeObserver((entries) => {
      const width = entries[0] && entries[0].contentRect.width;
      if (width) wrapWidth.value = width;
    });
    observer.observe(wrap.value);
  } else if (wrap.value) {
    wrapWidth.value = wrap.value.clientWidth;
  }
});

onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});

const listEl = ref(null);
watch(
  [selectedId, () => filteredMaps.value.length],
  async () => {
    await nextTick();
    const el = listEl.value && listEl.value.querySelector('.map-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  },
);

const { isBusy, run } = useAction();

async function afterChange() {
  await detailPoll.refresh();
  list.refresh();
}

const spawn = reactive({ npcId: null, name: '', amount: 1 });
const spawnAmount = computed(() => toInt(spawn.amount));
const canSpawn = computed(
  () => selected.value && spawn.npcId !== null && spawnAmount.value !== null && spawnAmount.value >= 1 && spawnAmount.value <= 20,
);

async function spawnNpc() {
  if (!canSpawn.value) return;
  const { x, y } = selected.value;
  const mapId = selectedId.value;
  const name = spawn.name || `NPC #${spawn.npcId}`;
  const amount = spawnAmount.value;
  const result = await run(() => api.spawnNpc(mapId, { npcId: spawn.npcId, x, y, amount }), {
    key: 'spawn',
    success: (r) => `Spawned ${r && r.spawned !== undefined ? r.spawned : amount} × ${name} at (${x}, ${y})`,
    failure: 'Spawn failed',
  });
  if (result) afterChange();
}

const drop = reactive({ itemId: null, name: '', amount: 1 });
const dropAmount = computed(() => toInt(drop.amount));
const canDrop = computed(() => selected.value && drop.itemId !== null && dropAmount.value !== null && dropAmount.value >= 1);

async function dropItem() {
  if (!canDrop.value) return;
  const { x, y } = selected.value;
  const mapId = selectedId.value;
  const name = drop.name || `item #${drop.itemId}`;
  const amount = dropAmount.value;
  const result = await run(() => api.dropItem(mapId, { itemId: drop.itemId, amount, x, y }), {
    key: 'drop',
    success: `Dropped ${formatNumber(amount)} × ${name} at (${x}, ${y})`,
    failure: 'Drop failed',
  });
  if (result) afterChange();
}

async function removeNpc(n) {
  const result = await run(() => api.removeNpc(selectedId.value, n.index), {
    key: `npc-${n.index}`,
    confirm: {
      title: 'Remove NPC',
      message: `Remove ${n.name} (#${n.index}) from the map?${n.spawned ? '' : '\nThis is a regular spawn; it will respawn on its normal timer.'}`,
      confirmLabel: 'Remove NPC',
      danger: true,
    },
    success: `Removed ${n.name}`,
    failure: 'Remove NPC failed',
  });
  if (result) afterChange();
}

async function removeGroundItem(it) {
  const result = await run(() => api.removeMapItem(selectedId.value, it.index), {
    key: `item-${it.index}`,
    confirm: {
      title: 'Remove ground item',
      message: `Remove ${formatNumber(it.amount)} × ${it.name} from (${it.x}, ${it.y})?`,
      confirmLabel: 'Remove item',
      danger: true,
    },
    success: `Removed ${it.name}`,
    failure: 'Remove item failed',
  });
  if (result) afterChange();
}

async function reloadMap() {
  const d = detail.value;
  const result = await run(() => api.reloadMap(d.id), {
    key: 'reload',
    confirm: {
      title: 'Reload map',
      message: `Reload map ${d.id} (${d.name || 'unnamed'}) from disk? NPCs and ground items on it may be reset.`,
      confirmLabel: 'Reload map',
      danger: true,
    },
    success: `Map ${d.id} reloaded`,
    failure: 'Reload failed',
  });
  if (result) afterChange();
}

const evac = reactive({ open: false, seconds: '' });
const evacSeconds = computed(() => (evac.seconds === '' || evac.seconds === null ? null : toInt(evac.seconds)));
const evacValid = computed(() => evac.seconds === '' || evac.seconds === null || (evacSeconds.value !== null && evacSeconds.value >= 0));

function openEvacuate() {
  if (evacuating.value) return;
  evac.seconds = '';
  evac.open = true;
}

async function evacuate() {
  if (!evacValid.value || evacuating.value) return;
  const d = detail.value;
  const seconds = evacSeconds.value;
  const result = await run(() => api.evacuateMap(d.id, seconds), {
    key: 'evacuate',
    success: `Evacuation of map ${d.id} started${seconds !== null ? ` (${seconds}s)` : ''}`,
    failure: 'Evacuate failed',
  });
  if (result) {
    evac.open = false;
    afterChange();
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <div class="page-title">
          <h1>Map viewer</h1>
          <template v-if="detail">
            <span class="dim">·</span>
            <h2 style="margin: 0">{{ detail.name || 'unnamed' }} <span class="mono dim">#{{ detail.id }}</span></h2>
            <StatusBadge v-if="detail.pk" status="pk" label="PK" />
            <StatusBadge v-if="evacuating" status="evacuating" label="Evacuating" />
          </template>
        </div>
        <div v-if="detail && counts" class="subtitle">
          {{ detail.width + 1 }}×{{ detail.height + 1 }} tiles · {{ counts.players }} players ·
          {{ counts.npcsAlive }}/{{ counts.npcsTotal }} NPCs alive{{ counts.spawned ? ` (${counts.spawned} spawned)` : '' }} ·
          {{ counts.items }} ground items · {{ counts.chests }} chests
        </div>
      </div>
      <div v-if="detail" class="row">
        <label class="row dim small">
          Zoom
          <select v-model="zoom" aria-label="Zoom">
            <option v-for="z in ZOOMS" :key="z" :value="z">{{ z === 'fit' ? 'Fit width' : `${z}px` }}</option>
          </select>
        </label>
        <button type="button" class="btn-sm" :disabled="isBusy('reload')" @click="reloadMap">Reload map…</button>
        <button
          type="button"
          class="btn-sm btn-danger"
          :disabled="evacuating || isBusy('evacuate')"
          :title="evacuating ? 'An evacuation is already in progress on this map' : ''"
          @click="openEvacuate"
        >
          {{ evacuating ? 'Evacuating…' : 'Evacuate…' }}
        </button>
      </div>
    </div>

    <div class="map-layout">
      <aside class="panel map-list">
        <div class="panel-head">
          <h3>Maps <span class="dim">({{ filteredMaps.length }})</span></h3>
          <span v-if="list.loading.value" class="spinner sm" aria-label="Loading"></span>
        </div>
        <input v-model="listFilter" type="search" placeholder="Filter by id or name…" aria-label="Filter maps" style="width: 100%" />
        <label class="check small" style="margin: 0.5rem 0">
          <input v-model="populatedOnly" type="checkbox" /> Only maps with players
        </label>
        <div v-if="list.error.value && !list.data.value" class="hint err">{{ list.error.value.message }}</div>
        <div ref="listEl" class="map-list-items" role="listbox" aria-label="Maps">
          <button
            v-for="m in filteredMaps"
            :key="m.id"
            type="button"
            role="option"
            class="map-item"
            :class="{ active: m.id === selectedId }"
            :aria-selected="m.id === selectedId"
            @click="selectMap(m.id)"
          >
            <span class="mono dim">{{ m.id }}</span>
            <span class="map-name">{{ m.name || 'unnamed' }}</span>
            <span class="map-counts">
              <span v-if="m.players" class="ok-text" :title="`${m.players} players`">☻{{ m.players }}</span>
              <span class="dim" :title="`${m.npcsAlive}/${m.npcsTotal} NPCs alive`">{{ m.npcsAlive }}/{{ m.npcsTotal }}</span>
              <span v-if="m.items" class="warn-text" :title="`${m.items} ground items`">◆{{ m.items }}</span>
              <span v-if="m.evacuating" class="badge tone-orange" title="Evacuation in progress">evac</span>
            </span>
          </button>
          <div v-if="list.data.value && !filteredMaps.length" class="hint" style="padding: 0.5rem">No maps match.</div>
        </div>
      </aside>

      <section class="panel map-canvas">
        <div v-if="notFound" class="state">Map #{{ selectedId }} was not found.</div>
        <div v-else-if="!detail && detailPoll.error.value" class="state state-error">
          {{ detailPoll.error.value.message }}
          <button type="button" class="btn-sm" @click="detailPoll.refresh">Retry</button>
        </div>
        <div v-else-if="!detail" class="state"><span class="spinner"></span> Loading map…</div>
        <div v-if="detail && detailPoll.error.value" class="inline-error">
          Live updates failed: {{ detailPoll.error.value.message }}
        </div>
        <div ref="wrap" class="canvas-wrap">
          <canvas
            v-show="detail"
            ref="canvas"
            @mousemove="onMove"
            @mouseleave="onLeave"
            @click="onClick"
          ></canvas>
        </div>
        <div v-if="detail" class="hint" style="margin-top: 0.5rem">
          Click a tile to inspect it, spawn NPCs or drop items. Updated {{ formatTime(detailPoll.updatedAt.value) }}.
        </div>
      </section>

      <aside class="map-side stack">
        <section class="panel">
          <div class="panel-head">
            <h3>{{ selected ? `Tile (${selected.x}, ${selected.y})` : 'Tile' }}</h3>
            <button v-if="selected" type="button" class="icon-btn" aria-label="Clear selection" @click="selected = null">×</button>
          </div>
          <p v-if="!selected" class="dim" style="margin: 0">Click a tile on the map to inspect it.</p>
          <div v-else-if="here" class="form-stack">
            <div v-if="here.specs.length" class="chips">
              <span v-for="(s, i) in here.specs" :key="i" class="badge tone-dim">{{ specName(s.spec) }}</span>
            </div>

            <div v-if="here.warp" class="small">
              Warp to
              <RouterLink :to="{ name: 'maps', query: { id: here.warp.map } }">map {{ here.warp.map }}</RouterLink>
              <span class="mono dim ml">({{ here.warp.destX }}, {{ here.warp.destY }})</span>
              <span v-if="here.warp.door" class="dim ml">· door</span>
            </div>

            <div v-if="here.players.length">
              <div class="field-label">Players</div>
              <div v-for="p in here.players" :key="p.characterId ?? p.name" class="row">
                <RouterLink v-if="p.characterId" :to="{ name: 'character', params: { id: p.characterId } }">{{ p.name }}</RouterLink>
                <span v-else>{{ p.name }}</span>
                <StatusBadge v-if="p.hidden" status="hidden" />
                <StatusBadge v-if="p.adminLevel > 0" status="staff" />
              </div>
            </div>

            <div v-if="here.npcs.length">
              <div class="field-label">NPCs</div>
              <div v-for="n in here.npcs" :key="n.index" class="row between">
                <span>
                  {{ n.name }} <span class="mono dim">#{{ n.id }} · idx {{ n.index }}</span>
                  <span class="dim small ml">{{ n.hp }}/{{ n.maxHp }}</span>
                  <StatusBadge v-if="n.spawned" status="spawned" style="margin-left: 0.25rem" />
                  <StatusBadge v-if="n.alive === false" status="dead" style="margin-left: 0.25rem" />
                </span>
                <button type="button" class="btn-sm btn-danger" :disabled="isBusy(`npc-${n.index}`)" @click="removeNpc(n)">Remove</button>
              </div>
            </div>

            <div v-if="here.items.length">
              <div class="field-label">Ground items</div>
              <div v-for="it in here.items" :key="it.index" class="row between">
                <span>{{ it.name }} <span class="mono dim">×{{ formatNumber(it.amount) }}</span></span>
                <button type="button" class="btn-sm btn-danger" :disabled="isBusy(`item-${it.index}`)" @click="removeGroundItem(it)">Remove</button>
              </div>
            </div>

            <div v-if="here.chest">
              <div class="field-label">Chest</div>
              <div v-if="(here.chest.items || []).length" class="small">
                Contains:
                <span v-for="(ci, i) in here.chest.items" :key="i">{{ i ? ', ' : '' }}{{ ci.name }} ×{{ ci.amount }}</span>
              </div>
              <div v-else class="small dim">Empty.</div>
              <div v-for="(s, i) in here.chest.spawns || []" :key="`s${i}`" class="small dim">
                {{ s.name }} ×{{ s.amount }} every {{ s.spawnMinutes }}m —
                <span :class="s.available ? 'ok-text' : ''">{{ s.available ? 'available' : `in ${formatTimer(s.secondsRemaining)}` }}</span>
              </div>
            </div>

            <form class="form-stack" style="border-top: 1px solid var(--border); padding-top: 0.8rem" @submit.prevent="spawnNpc">
              <div class="field">
                <span class="field-label">Spawn NPC here</span>
                <NpcPicker v-model="spawn.npcId" @select="spawn.name = $event ? $event.name : ''" />
              </div>
              <div class="row">
                <label class="row small dim">
                  Amount
                  <input v-model="spawn.amount" type="number" min="1" max="20" step="1" style="width: 5rem" />
                </label>
                <button type="submit" class="btn-accent btn-sm" :disabled="!canSpawn || isBusy('spawn')">Spawn</button>
              </div>
              <div v-if="spawnAmount === null || spawnAmount < 1 || spawnAmount > 20" class="hint err">Amount must be 1–20.</div>
            </form>

            <form class="form-stack" style="border-top: 1px solid var(--border); padding-top: 0.8rem" @submit.prevent="dropItem">
              <div class="field">
                <span class="field-label">Drop item here</span>
                <ItemPicker v-model="drop.itemId" @select="drop.name = $event ? $event.name : ''" />
              </div>
              <div class="row">
                <label class="row small dim">
                  Amount
                  <input v-model="drop.amount" type="number" min="1" step="1" style="width: 6rem" />
                </label>
                <button type="submit" class="btn-accent btn-sm" :disabled="!canDrop || isBusy('drop')">Drop</button>
              </div>
            </form>
          </div>
        </section>

        <details class="panel legend">
          <summary><strong>Legend</strong></summary>
          <div class="legend-grid">
            <div v-for="l in LEGEND" :key="l.label"><span class="sw" :style="l.style"></span>{{ l.label }}</div>
          </div>
          <div class="hint" style="margin-top: 0.5rem">Players with a yellow ring are staff.</div>
        </details>
      </aside>
    </div>

    <div
      v-if="tooltip"
      class="map-tooltip mono"
      :style="{ left: `${tooltip.x + 14}px`, top: `${tooltip.y + 14}px` }"
    >{{ tooltip.text }}</div>

    <Modal :open="evac.open" :title="detail ? `Evacuate map ${detail.id}` : 'Evacuate'" width="420px" @close="evac.open = false">
      <form v-if="detail" class="form-stack" @submit.prevent="evacuate">
        <p>
          Warn everyone on <strong>{{ detail.name || 'unnamed' }}</strong> ({{ counts ? counts.players : 0 }} players), then warp them off the map.
        </p>
        <label class="field">
          <span>Countdown seconds (blank = server default)</span>
          <input v-model="evac.seconds" type="number" min="0" step="1" :class="{ invalid: !evacValid }" />
        </label>
        <div class="modal-actions">
          <button type="button" @click="evac.open = false">Cancel</button>
          <button type="submit" class="btn-danger-solid" :disabled="!evacValid || evacuating || isBusy('evacuate')">Evacuate</button>
        </div>
      </form>
    </Modal>
  </div>
</template>

<style scoped>
.map-layout {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 320px;
  grid-template-areas: 'list canvas side';
  gap: 1.25rem;
  align-items: start;
}
.map-layout > .panel {
  margin-top: 0;
}
.map-list {
  grid-area: list;
}
.map-canvas {
  grid-area: canvas;
}
.map-side {
  grid-area: side;
}
.map-list-items {
  max-height: calc(100vh - 290px);
  min-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0 -0.4rem;
}
.map-item {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  justify-content: flex-start;
  background: transparent;
  border: 1px solid transparent;
  padding: 0.3rem 0.4rem;
  text-align: left;
  font-size: 0.85rem;
}
.map-item:hover:not(:disabled) {
  background: var(--bg-panel-2);
  border-color: transparent;
}
.map-item.active {
  background: var(--accent-dim);
  color: #fff;
}
.map-item .mono {
  min-width: 2.2rem;
}
.map-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.map-counts {
  display: flex;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.canvas-wrap {
  overflow: auto;
  max-height: calc(100vh - 230px);
  min-height: 120px;
}
.canvas-wrap canvas {
  display: block;
  cursor: crosshair;
}
.legend summary {
  cursor: pointer;
}
.legend-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.3rem 0.75rem;
  margin-top: 0.6rem;
  color: var(--text-dim);
  font-size: 0.82rem;
}
.legend-grid div {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}
.sw {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
  flex: none;
}
.map-tooltip {
  position: fixed;
  background: #000e;
  border: 1px solid var(--border);
  padding: 0.35rem 0.55rem;
  border-radius: 6px;
  font-size: 0.76rem;
  pointer-events: none;
  white-space: pre;
  z-index: 60;
  max-width: 420px;
  overflow: hidden;
}
@media (max-width: 1400px) {
  .map-layout {
    grid-template-columns: minmax(0, 1fr) 300px;
    grid-template-areas:
      'canvas side'
      'canvas list';
  }
  .map-list-items {
    max-height: 360px;
  }
}
@media (max-width: 900px) {
  .map-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      'canvas'
      'side'
      'list';
  }
}
</style>
