<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { adminLabel, debounce } from '../util.js';

const state = useRouteQuery({ q: '', status: 'all', offset: 0, limit: 50 });
const draft = ref(state.q);

watch(
  () => state.q,
  (q) => {
    if (q !== draft.value.trim()) draft.value = q;
  },
);

const applySearch = debounce(() => {
  const q = draft.value.trim();
  if (q === state.q) return;
  state.q = q;
  state.offset = 0;
}, 350);

function submitSearch() {
  applySearch.cancel();
  state.q = draft.value.trim();
  state.offset = 0;
}

function setStatus(value) {
  state.status = value;
  state.offset = 0;
}

const poll = usePolling((p) => api.characters(p), {
  params: () => ({ q: state.q, status: state.status, offset: state.offset, limit: state.limit }),
  interval: 15000,
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));

const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' },
];
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Characters</h1>
        <div class="subtitle">Search every character, online or offline.</div>
      </div>
    </div>

    <form class="toolbar" role="search" @submit.prevent="submitSearch">
      <input
        v-model="draft"
        type="search"
        class="search-input"
        placeholder="Name, id…"
        aria-label="Search characters"
        @input="applySearch"
      />
      <div class="segmented" role="radiogroup" aria-label="Status">
        <button
          v-for="s in STATUSES"
          :key="s.value"
          type="button"
          role="radio"
          :aria-checked="state.status === s.value"
          :class="{ on: state.status === s.value }"
          @click="setStatus(s.value)"
        >
          {{ s.label }}
        </button>
      </div>
      <span v-if="poll.loading.value" class="spinner sm" aria-label="Loading"></span>
    </form>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="items.length === 0"
      :empty-text="state.q ? `No characters match “${state.q}”.` : 'No characters found.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Account</th>
              <th class="num">Lvl</th>
              <th>Class</th>
              <th>Location</th>
              <th>Guild</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in items" :key="c.id">
              <td>
                <RouterLink :to="{ name: 'character', params: { id: c.id } }"><strong>{{ c.name }}</strong></RouterLink>
                <StatusBadge v-if="c.adminLevel > 0" status="staff" :label="adminLabel(c.adminLevel)" style="margin-left: 0.35rem" />
              </td>
              <td><StatusBadge :status="c.online ? 'online' : 'offline'" /></td>
              <td>
                <RouterLink :to="{ name: 'account', params: { id: c.accountId } }">{{ c.accountName }}</RouterLink>
              </td>
              <td class="num">{{ c.level }}</td>
              <td class="dim">{{ c.className }}</td>
              <td>
                <RouterLink :to="{ name: 'maps', query: { id: c.map } }">Map {{ c.map }}</RouterLink>
                <span class="mono dim ml">{{ c.x }},{{ c.y }}</span>
              </td>
              <td>
                <RouterLink v-if="c.guildTag" :to="{ name: 'guild', params: { tag: c.guildTag } }" class="mono">{{ c.guildTag }}</RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td class="dim"><TimeAgo :value="c.createdAt" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
    <Pagination
      v-if="poll.data.value !== null"
      v-model:offset="state.offset"
      v-model:limit="state.limit"
      :total="total"
    />
  </div>
</template>
