<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useStatus } from '../stores/status.js';
import {
  categoryColor,
  formatBytes,
  formatDateTime,
  formatFull,
  formatMs,
  formatRelative,
  formatTime,
  formatUptime,
  levelName,
  levelTone,
  percent,
} from '../util.js';

const { status, error: statusError, refresh: refreshStatus } = useStatus();
const players = usePolling(() => api.players(), { interval: 5000 });
const recent = usePolling(() => api.logs({ limit: 15, minLevel: 30 }), { interval: 5000 });

const onlineList = computed(() => {
  const list = Array.isArray(players.data.value) ? [...players.data.value] : [];
  return list.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
});

const recentEvents = computed(() => {
  const events = recent.data.value && Array.isArray(recent.data.value.events) ? recent.data.value.events : [];
  return [...events].reverse();
});

function slnSummary(sln) {
  if (!sln || !sln.enabled) return { value: 'Disabled', tone: '', sub: 'Server link not configured' };
  if (sln.lastError) return { value: 'Error', tone: 'tone-bad', sub: sln.lastError };
  if (!sln.lastPingAt) return { value: 'Enabled', tone: '', sub: 'Not pinged yet' };
  return { value: 'Online', tone: 'tone-ok', sub: `pinged ${formatRelative(sln.lastPingAt)}${sln.lastResult ? ` · ${sln.lastResult}` : ''}` };
}

const cards = computed(() => {
  const s = status.value;
  if (!s) return [];
  const tick = s.tick || {};
  const sln = slnSummary(s.sln);
  const load = percent(s.online, s.maxPlayers);
  return [
    {
      label: 'Players online',
      value: String(s.online),
      suffix: `/ ${s.maxPlayers}`,
      sub: `${s.connections} connection${s.connections === 1 ? '' : 's'} · ${Math.round(load)}% full`,
      tone: load >= 90 ? 'tone-warn' : '',
    },
    { label: 'Uptime', value: formatUptime(s.uptimeSeconds), sub: `since ${formatDateTime(s.startedAt)}`, title: formatFull(s.startedAt) },
    { label: 'Memory (RSS)', value: formatBytes(s.memory && s.memory.rss), sub: `heap ${formatBytes(s.memory && s.memory.heapUsed)}` },
    {
      label: 'Tick avg',
      value: formatMs(tick.avgMs),
      sub: `max ${formatMs(tick.maxMs)} · budget ${tick.rateMs ?? '—'} ms`,
      tone: tick.maxMs > tick.rateMs ? 'tone-warn' : '',
    },
    { label: 'Database', value: s.database || '—', sub: `${s.maps} maps loaded` },
    {
      label: 'Global chat',
      value: s.globalChatLocked ? 'Locked' : 'Open',
      sub: s.globalChatLocked ? 'Players cannot use ~global' : 'Players can use ~global',
      tone: s.globalChatLocked ? 'tone-warn' : 'tone-ok',
    },
    {
      label: 'Last save',
      value: s.lastSaveAt ? formatRelative(s.lastSaveAt) : 'Never',
      sub: s.lastSaveAt ? formatDateTime(s.lastSaveAt) : 'No save recorded yet',
      title: formatFull(s.lastSaveAt),
    },
    { label: 'SLN', value: sln.value, sub: sln.sub, tone: sln.tone, title: sln.sub },
  ];
});

function fieldSummary(event) {
  const parts = [];
  for (const [key, value] of Object.entries(event)) {
    if (['seq', 'time', 'level', 'cat', 'msg'].includes(key)) continue;
    if (value === null || value === undefined || typeof value === 'object') continue;
    parts.push(`${key}=${value}`);
    if (parts.length >= 4) break;
  }
  return parts.join(' ');
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Dashboard</h1>
        <div v-if="status" class="subtitle">
          {{ status.name }} {{ status.version }} · TCP {{ status.tcpPort }} · WS {{ status.wsPort }}
        </div>
      </div>
      <RouterLink class="btn" to="/server">Server controls →</RouterLink>
    </div>

    <AsyncState :ready="Boolean(status)" :error="statusError" @retry="refreshStatus">
      <div class="cards">
        <div v-for="card in cards" :key="card.label" class="card" :class="card.tone" :title="card.title">
          <div class="label">{{ card.label }}</div>
          <div class="value">{{ card.value }} <small v-if="card.suffix">{{ card.suffix }}</small></div>
          <div class="sub">{{ card.sub }}</div>
        </div>
      </div>
    </AsyncState>

    <div class="grid-2 section">
      <div class="panel">
        <div class="panel-head">
          <h3>Online now <span class="dim">({{ onlineList.length }})</span></h3>
          <RouterLink to="/players">All players →</RouterLink>
        </div>
        <AsyncState
          :ready="players.data.value !== null"
          :error="players.error.value"
          :empty="onlineList.length === 0"
          empty-text="No players online."
          @retry="players.refresh"
        >
          <div class="table-wrap plain" style="max-height: 420px">
            <table class="table-compact">
              <thead>
                <tr><th>Name</th><th class="num">Lvl</th><th>Class</th><th>Map</th><th>Connected</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in onlineList.slice(0, 15)" :key="p.id">
                  <td>
                    <RouterLink :to="{ name: 'character', params: { id: p.id } }">{{ p.name }}</RouterLink>
                    <StatusBadge v-if="p.adminLevel > 0" status="staff" style="margin-left: 0.35rem" />
                    <StatusBadge v-if="p.hidden" status="hidden" style="margin-left: 0.25rem" />
                  </td>
                  <td class="num">{{ p.level }}</td>
                  <td class="dim">{{ p.className }}</td>
                  <td>
                    <RouterLink :to="{ name: 'maps', query: { id: p.map } }">{{ p.mapName || `Map ${p.map}` }}</RouterLink>
                    <span class="mono dim ml">{{ p.x }},{{ p.y }}</span>
                  </td>
                  <td class="dim" :title="formatFull(p.connectedAt)">{{ formatRelative(p.connectedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="onlineList.length > 15" class="hint" style="margin-top: 0.5rem">
            Showing 15 of {{ onlineList.length }}.
          </div>
        </AsyncState>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3>Recent activity</h3>
          <RouterLink to="/logs">Logs →</RouterLink>
        </div>
        <AsyncState
          :ready="recent.data.value !== null"
          :error="recent.error.value"
          :empty="recentEvents.length === 0"
          empty-text="No events yet."
          @retry="recent.refresh"
        >
          <div v-for="e in recentEvents" :key="e.seq" class="feed-row">
            <span class="mono dim small" :title="formatFull(e.time)">{{ formatTime(e.time) }}</span>
            <span
              class="badge"
              :style="{ color: categoryColor(e.cat), borderColor: `${categoryColor(e.cat)}55` }"
            >{{ e.cat }}</span>
            <StatusBadge v-if="levelName(e.level) !== 'info'" :status="levelName(e.level)" :tone="levelTone(e.level)" />
            <span class="msg" :title="`${e.msg} ${fieldSummary(e)}`">
              {{ e.msg }} <span class="mono dim small">{{ fieldSummary(e) }}</span>
            </span>
          </div>
        </AsyncState>
      </div>
    </div>
  </div>
</template>
