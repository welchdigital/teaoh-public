<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { debounce } from '../util.js';

const state = useRouteQuery({ q: '', offset: 0, limit: 50 });
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

const poll = usePolling((p) => api.accounts(p), {
  params: () => ({ q: state.q, offset: state.offset, limit: state.limit }),
  interval: 20000,
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Accounts</h1>
        <div class="subtitle">Search by account name, email, real name or IP.</div>
      </div>
    </div>

    <form class="toolbar" role="search" @submit.prevent="submitSearch">
      <input
        v-model="draft"
        type="search"
        class="search-input"
        placeholder="Account name, email, IP…"
        aria-label="Search accounts"
        @input="applySearch"
      />
      <span v-if="poll.loading.value" class="spinner sm" aria-label="Loading"></span>
    </form>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="items.length === 0"
      :empty-text="state.q ? `No accounts match “${state.q}”.` : 'No accounts found.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>State</th>
              <th>Email</th>
              <th>Real name</th>
              <th class="num">Chars</th>
              <th>Created</th>
              <th>Last login</th>
              <th>Last IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in items" :key="a.id">
              <td>
                <RouterLink :to="{ name: 'account', params: { id: a.id } }"><strong>{{ a.name }}</strong></RouterLink>
                <span class="mono dim ml">#{{ a.id }}</span>
              </td>
              <td>
                <StatusBadge v-if="a.online" status="online" />
                <StatusBadge v-if="a.banned" status="banned" />
                <StatusBadge v-if="a.locked" status="locked" />
                <span v-if="!a.online && !a.banned && !a.locked" class="dim">—</span>
              </td>
              <td class="dim">{{ a.email || '—' }}</td>
              <td class="dim">{{ a.realName || '—' }}</td>
              <td class="num">{{ a.characterCount }}</td>
              <td class="dim"><TimeAgo :value="a.createdAt" /></td>
              <td class="dim"><TimeAgo :value="a.lastLoginAt" empty="never" /></td>
              <td class="mono dim">{{ a.lastIp || '—' }}</td>
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
