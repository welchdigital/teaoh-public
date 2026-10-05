<script setup>
import { computed, reactive, ref } from 'vue';
import { api, usePolling, useTail } from '../api.js';
import StatusBadge from '../components/StatusBadge.vue';
import {
  KNOWN_CATEGORIES,
  LOG_LEVELS,
  categoryColor,
  formatFull,
  formatTime,
  levelName,
  levelTone,
  prettyJson,
  textOf,
} from '../util.js';

const MAX_ROWS = 2000;
const RESERVED = new Set(['seq', 'time', 'level', 'cat', 'msg']);

const categoriesPoll = usePolling(() => api.logCategories(), { interval: 15000 });

const selected = ref([]);
const minLevel = ref(30);
const searchDraft = ref('');
const search = ref('');
const paused = ref(false);
const expanded = reactive(new Set());

const params = computed(() => ({
  categories: selected.value.length ? [...selected.value].sort().join(',') : undefined,
  minLevel: minLevel.value,
  search: search.value || undefined,
}));

const tail = useTail((p) => api.logs(p), { params, paused, interval: 2000, limit: 500, max: MAX_ROWS });

const counts = computed(() => {
  const data = categoriesPoll.data.value;
  return data && typeof data === 'object' ? data : {};
});

const categories = computed(() => {
  const names = new Set([...KNOWN_CATEGORIES, ...Object.keys(counts.value)]);
  return [...names].sort((a, b) => (counts.value[b] || 0) - (counts.value[a] || 0) || a.localeCompare(b));
});

function toggleCategory(cat) {
  const set = new Set(selected.value);
  if (set.has(cat)) set.delete(cat);
  else set.add(cat);
  selected.value = [...set];
}

function applySearch() {
  search.value = searchDraft.value.trim();
}

function clearSearch() {
  searchDraft.value = '';
  search.value = '';
}

const rows = computed(() => tail.events.value.slice().reverse());

function fields(event) {
  const out = {};
  for (const [key, value] of Object.entries(event)) {
    if (!RESERVED.has(key)) out[key] = value;
  }
  return out;
}

function fieldSummary(event) {
  const parts = [];
  for (const [key, value] of Object.entries(event)) {
    if (RESERVED.has(key) || value === undefined) continue;
    parts.push(`${key}=${textOf(value)}`);
  }
  const text = parts.join('  ');
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function toggleRow(seq) {
  if (expanded.has(seq)) expanded.delete(seq);
  else expanded.add(seq);
}

function clearView() {
  tail.clear();
  expanded.clear();
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Logs</h1>
        <div class="subtitle">
          Live tail of server events. Showing up to {{ MAX_ROWS.toLocaleString() }} most recent matching events.
        </div>
      </div>
      <div class="row">
        <StatusBadge :status="paused ? 'paused' : 'live'" :tone="paused ? 'yellow' : 'green'" />
        <button type="button" :class="paused ? 'btn-accent' : ''" @click="paused = !paused">
          {{ paused ? 'Resume' : 'Pause' }}
        </button>
        <button type="button" @click="clearView">Clear view</button>
      </div>
    </div>

    <div class="panel" style="margin-bottom: 1rem">
      <div class="chips" style="margin-bottom: 0.75rem" role="group" aria-label="Categories">
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          class="chip"
          :class="{ on: selected.includes(cat) }"
          :aria-pressed="selected.includes(cat)"
          :style="selected.includes(cat) ? { borderColor: categoryColor(cat), background: `${categoryColor(cat)}33`, color: '#fff' } : {}"
          @click="toggleCategory(cat)"
        >
          <span class="dot" :style="{ background: categoryColor(cat), margin: 0 }"></span>
          {{ cat }}
          <span v-if="counts[cat]" class="dim">{{ counts[cat].toLocaleString() }}</span>
        </button>
        <button v-if="selected.length" type="button" class="chip" @click="selected = []">× all categories</button>
      </div>
      <form class="row" role="search" @submit.prevent="applySearch">
        <input
          v-model="searchDraft"
          type="search"
          class="search-input"
          placeholder="Search message and fields, press Enter"
          aria-label="Search logs"
          @keydown.esc="clearSearch"
        />
        <button type="submit">Search</button>
        <button v-if="search" type="button" class="btn-ghost" @click="clearSearch">Clear “{{ search }}”</button>
        <label class="row dim small">
          Min level
          <select v-model.number="minLevel">
            <option v-for="l in LOG_LEVELS" :key="l.value" :value="l.value">{{ l.label }}</option>
          </select>
        </label>
        <span class="dim small right">
          <span v-if="tail.loading.value" class="spinner sm" style="vertical-align: middle"></span>
          {{ rows.length.toLocaleString() }} shown{{ tail.cursor.value !== null ? ` · seq ${tail.cursor.value}` : '' }}
        </span>
      </form>
    </div>

    <div v-if="tail.error.value" class="inline-error" role="alert">
      {{ tail.error.value.message }}
      <button type="button" class="btn-sm btn-ghost" @click="tail.refresh">Retry</button>
    </div>

    <div class="table-wrap tall">
      <table class="table-compact">
        <thead>
          <tr>
            <th style="width: 80px">Time</th>
            <th style="width: 110px">Category</th>
            <th style="width: 60px">Level</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody v-for="e in rows" :key="e.seq" v-memo="[e.seq, expanded.has(e.seq)]">
          <tr class="clickable" :class="{ expanded: expanded.has(e.seq) }" :aria-expanded="expanded.has(e.seq)" @click="toggleRow(e.seq)">
            <td class="mono dim" :title="formatFull(e.time)">{{ formatTime(e.time) }}</td>
            <td>
              <span class="badge" :style="{ color: categoryColor(e.cat), borderColor: `${categoryColor(e.cat)}55` }">{{ e.cat }}</span>
            </td>
            <td><StatusBadge :status="levelName(e.level)" :tone="levelTone(e.level)" /></td>
            <td class="wrap">
              {{ e.msg }}
              <span class="mono dim small" style="margin-left: 0.5rem">{{ fieldSummary(e) }}</span>
            </td>
          </tr>
          <tr v-if="expanded.has(e.seq)" class="detail-row">
            <td colspan="4">
              <div class="small dim" style="margin-bottom: 0.35rem">seq {{ e.seq }} · {{ formatFull(e.time) }}</div>
              <pre class="code">{{ prettyJson(fields(e)) }}</pre>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!tail.ready.value && !tail.error.value" class="state"><span class="spinner"></span> Loading…</div>
      <div v-else-if="tail.ready.value && rows.length === 0" class="state">
        No matching events{{ paused ? ' (paused)' : ' yet' }}.
      </div>
    </div>
  </div>
</template>
