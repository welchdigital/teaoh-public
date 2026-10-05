<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { debounce, formatNumber } from '../util.js';

const state = useRouteQuery({ q: '', sort: 'members' });
const draft = ref(state.q);

watch(
  () => state.q,
  (q) => {
    if (q !== draft.value.trim()) draft.value = q;
  },
);

const applySearch = debounce(() => {
  state.q = draft.value.trim();
}, 350);

function submitSearch() {
  applySearch.cancel();
  state.q = draft.value.trim();
}

const poll = usePolling((p) => api.guilds(p.q), {
  params: () => ({ q: state.q }),
  interval: 30000,
});

const SORTS = {
  members: (a, b) => b.memberCount - a.memberCount || a.tag.localeCompare(b.tag),
  online: (a, b) => b.onlineCount - a.onlineCount || b.memberCount - a.memberCount,
  tag: (a, b) => a.tag.localeCompare(b.tag),
  bank: (a, b) => b.bank - a.bank,
  created: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
};

const items = computed(() => {
  const list = Array.isArray(poll.data.value) ? [...poll.data.value] : [];
  return list.sort(SORTS[state.sort] || SORTS.members);
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Guilds</h1>
        <div class="subtitle">{{ items.length }} guild{{ items.length === 1 ? '' : 's' }}</div>
      </div>
    </div>

    <form class="toolbar" role="search" @submit.prevent="submitSearch">
      <input
        v-model="draft"
        type="search"
        class="search-input"
        placeholder="Tag or name…"
        aria-label="Search guilds"
        @input="applySearch"
      />
      <label class="row dim small">
        Sort
        <select v-model="state.sort">
          <option value="members">Members</option>
          <option value="online">Online</option>
          <option value="tag">Tag</option>
          <option value="bank">Bank</option>
          <option value="created">Newest</option>
        </select>
      </label>
      <span v-if="poll.loading.value" class="spinner sm" aria-label="Loading"></span>
    </form>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="items.length === 0"
      :empty-text="state.q ? `No guilds match “${state.q}”.` : 'No guilds yet.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th>Name</th>
              <th class="num">Members</th>
              <th class="num">Online</th>
              <th class="num">Bank</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="g in items" :key="g.id ?? g.tag">
              <td>
                <RouterLink :to="{ name: 'guild', params: { tag: g.tag } }" class="mono"><strong>{{ g.tag }}</strong></RouterLink>
              </td>
              <td>
                <RouterLink :to="{ name: 'guild', params: { tag: g.tag } }">{{ g.name }}</RouterLink>
              </td>
              <td class="num">{{ g.memberCount }}</td>
              <td class="num" :class="{ 'ok-text': g.onlineCount > 0, dim: !g.onlineCount }">{{ g.onlineCount }}</td>
              <td class="num mono">{{ formatNumber(g.bank) }}</td>
              <td class="dim"><TimeAgo :value="g.createdAt" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </AsyncState>
  </div>
</template>
