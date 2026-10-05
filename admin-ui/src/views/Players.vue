<script setup>
import { computed, reactive } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api, usePolling } from '../api.js';
import ActionsMenu from '../components/ActionsMenu.vue';
import AsyncState from '../components/AsyncState.vue';
import PlayerActionDialog from '../components/PlayerActionDialog.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useModeration } from '../composables/useModeration.js';
import { adminLabel, percent } from '../util.js';

const router = useRouter();
const poll = usePolling(() => api.players(), { interval: 3000 });
const moderation = useModeration(() => poll.refresh());

const filters = reactive({ q: '', map: '', flag: '', sort: 'name' });
const dialog = reactive({ action: null, target: null });

const FLAGS = [
  { value: '', label: 'Everyone' },
  { value: 'staff', label: 'Staff' },
  { value: 'hidden', label: 'Hidden' },
  { value: 'muted', label: 'Muted' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'jailed', label: 'Jailed' },
];

const players = computed(() => (Array.isArray(poll.data.value) ? poll.data.value : []));

const mapOptions = computed(() => {
  const seen = new Map();
  for (const p of players.value) {
    const entry = seen.get(p.map) || { id: p.map, name: p.mapName, count: 0 };
    entry.count += 1;
    seen.set(p.map, entry);
  }
  return [...seen.values()].sort((a, b) => a.id - b.id);
});

const SORTS = {
  name: (a, b) => a.name.localeCompare(b.name),
  level: (a, b) => b.level - a.level || a.name.localeCompare(b.name),
  map: (a, b) => a.map - b.map || a.name.localeCompare(b.name),
  connected: (a, b) => String(a.connectedAt || '').localeCompare(String(b.connectedAt || '')),
};

const filtered = computed(() => {
  const q = filters.q.trim().toLowerCase();
  const list = players.value.filter((p) => {
    if (filters.map !== '' && p.map !== Number(filters.map)) return false;
    if (filters.flag === 'staff' && !(p.adminLevel > 0)) return false;
    if (filters.flag && filters.flag !== 'staff' && !p[filters.flag]) return false;
    if (!q) return true;
    return [p.name, p.accountName, p.ip, p.guildTag, p.className]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
  return list.sort(SORTS[filters.sort] || SORTS.name);
});

function openDialog(action, p) {
  moderation.clearError(action);
  dialog.target = p;
  dialog.action = action;
}

function closeDialog() {
  dialog.action = null;
}

async function onDialogSubmit(payload) {
  const target = dialog.target;
  let result = null;
  if (dialog.action === 'message') result = await moderation.message(target, payload.message);
  else if (dialog.action === 'warp') result = await moderation.warp(target, payload);
  else if (dialog.action === 'mute') result = await moderation.mute(target, payload.durationMinutes, payload.reason);
  if (result) closeDialog();
}

function menuFor(p) {
  return [
    { label: 'View character', onSelect: () => router.push({ name: 'character', params: { id: p.id } }) },
    { label: 'Show on map', onSelect: () => router.push({ name: 'maps', query: { id: p.map } }) },
    { separator: true },
    { label: 'Send message…', onSelect: () => openDialog('message', p) },
    { label: 'Warp to…', onSelect: () => openDialog('warp', p) },
    { separator: true },
    p.muted
      ? { label: 'Unmute', onSelect: () => moderation.unmute(p) }
      : { label: 'Mute…', onSelect: () => openDialog('mute', p) },
    p.frozen
      ? { label: 'Unfreeze', onSelect: () => moderation.unfreeze(p) }
      : { label: 'Freeze', onSelect: () => moderation.freeze(p) },
    p.jailed
      ? { label: 'Free from jail', onSelect: () => moderation.free(p) }
      : { label: 'Jail…', danger: true, onSelect: () => moderation.jail(p) },
    { separator: true },
    { label: 'Kick…', danger: true, onSelect: () => moderation.kick(p, false) },
    { label: 'Silent kick…', danger: true, onSelect: () => moderation.kick(p, true) },
    {
      label: 'Ban…',
      danger: true,
      onSelect: () => router.push({ name: 'character', params: { id: p.id }, query: { tab: 'moderation' } }),
    },
  ];
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Online players</h1>
        <div class="subtitle">Live view, refreshed every 3 seconds.</div>
      </div>
      <RouterLink class="btn" to="/characters">Search all characters →</RouterLink>
    </div>

    <div class="toolbar">
      <input
        v-model="filters.q"
        type="search"
        class="search-input"
        placeholder="Filter by name, account, IP, guild, class…"
        aria-label="Filter players"
      />
      <select v-model="filters.map" aria-label="Filter by map">
        <option value="">All maps</option>
        <option v-for="m in mapOptions" :key="m.id" :value="m.id">{{ m.id }} · {{ m.name || 'unnamed' }} ({{ m.count }})</option>
      </select>
      <div class="chips" role="group" aria-label="Filter by state">
        <button
          v-for="f in FLAGS"
          :key="f.value"
          type="button"
          class="chip"
          :class="{ on: filters.flag === f.value }"
          :aria-pressed="filters.flag === f.value"
          @click="filters.flag = f.value"
        >
          {{ f.label }}
        </button>
      </div>
      <label class="row dim small right">
        Sort
        <select v-model="filters.sort">
          <option value="name">Name</option>
          <option value="level">Level</option>
          <option value="map">Map</option>
          <option value="connected">Connected</option>
        </select>
      </label>
    </div>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="filtered.length === 0"
      :empty-text="players.length ? 'No players match the filters.' : 'No players online.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Account</th>
              <th class="num">Lvl</th>
              <th>Class</th>
              <th>Map</th>
              <th>HP / TP</th>
              <th>Guild</th>
              <th>IP</th>
              <th>Connected</th>
              <th class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in filtered" :key="p.id">
              <td>
                <RouterLink :to="{ name: 'character', params: { id: p.id } }"><strong>{{ p.name }}</strong></RouterLink>
                <span style="margin-left: 0.35rem">
                  <StatusBadge v-if="p.adminLevel > 0" status="staff" :label="adminLabel(p.adminLevel)" />
                  <StatusBadge v-if="p.hidden" status="hidden" />
                  <StatusBadge v-if="p.muted" status="muted" />
                  <StatusBadge v-if="p.frozen" status="frozen" />
                  <StatusBadge v-if="p.jailed" status="jailed" />
                </span>
              </td>
              <td>
                <RouterLink :to="{ name: 'account', params: { id: p.accountId } }">{{ p.accountName }}</RouterLink>
              </td>
              <td class="num">{{ p.level }}</td>
              <td class="dim">{{ p.className }}</td>
              <td>
                <RouterLink :to="{ name: 'maps', query: { id: p.map } }">{{ p.mapName || `Map ${p.map}` }}</RouterLink>
                <span class="mono dim ml">{{ p.x }},{{ p.y }}</span>
              </td>
              <td style="min-width: 110px">
                <div class="meter" :title="`HP ${p.hp}/${p.maxHp}`"><span :style="{ width: `${percent(p.hp, p.maxHp)}%` }"></span></div>
                <div class="meter tp" style="margin-top: 3px" :title="`TP ${p.tp}/${p.maxTp}`"><span :style="{ width: `${percent(p.tp, p.maxTp)}%` }"></span></div>
              </td>
              <td>
                <RouterLink v-if="p.guildTag" :to="{ name: 'guild', params: { tag: p.guildTag } }" class="mono">{{ p.guildTag }}</RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td class="mono dim">{{ p.ip }}</td>
              <td class="dim"><TimeAgo :value="p.connectedAt" /></td>
              <td class="actions">
                <ActionsMenu :items="menuFor(p)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="hint" style="margin-top: 0.5rem">{{ filtered.length }} of {{ players.length }} online.</div>
    </AsyncState>

    <PlayerActionDialog
      :action="dialog.action"
      :target="dialog.target"
      :busy="Boolean(moderation.busy.value)"
      :error="dialog.action ? moderation.errorFor(dialog.action) : ''"
      @close="closeDialog"
      @submit="onDialogSubmit"
    />
  </div>
</template>
