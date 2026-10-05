<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useAction } from '../composables/useAction.js';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { formatFull, formatMinutes, toDate } from '../util.js';

const state = useRouteQuery({ active: 'true', offset: 0, limit: 50 });

const FILTERS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
  { value: 'all', label: 'All' },
];

function setFilter(value) {
  state.active = value;
  state.offset = 0;
}

const poll = usePolling((p) => api.mutes(p), {
  params: () => ({ active: state.active, offset: state.offset, limit: state.limit }),
  interval: 15000,
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));

const { isBusy, run } = useAction();

function duration(m) {
  const start = toDate(m.createdAt);
  const end = toDate(m.expiresAt);
  if (!end) return 'indefinite';
  if (!start) return '—';
  return formatMinutes(Math.max(1, Math.round((end - start) / 60000)));
}

async function unmute(m) {
  const result = await run(() => api.unmuteCharacter(m.characterId), {
    key: `unmute-${m.id}`,
    success: `${m.characterName} unmuted`,
    failure: 'Unmute failed',
  });
  if (result) poll.refresh();
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Mutes</h1>
        <div class="subtitle">Chat mutes issued in game or through this panel. Mute characters from their Moderation tab.</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Mute filter">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          role="radio"
          :aria-checked="state.active === f.value"
          :class="{ on: state.active === f.value }"
          @click="setFilter(f.value)"
        >
          {{ f.label }}
        </button>
      </div>
      <span v-if="poll.loading.value" class="spinner sm" aria-label="Loading"></span>
    </div>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="items.length === 0"
      :empty-text="state.active === 'true' ? 'Nobody is muted.' : 'No mutes found.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>State</th>
              <th>Character</th>
              <th>Reason</th>
              <th>Duration</th>
              <th>Muted</th>
              <th class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in items" :key="m.id">
              <td class="mono dim">{{ m.id }}</td>
              <td><StatusBadge :status="m.active ? 'active' : 'expired'" :tone="m.active ? 'yellow' : 'dim'" /></td>
              <td>
                <RouterLink :to="{ name: 'character', params: { id: m.characterId } }">{{ m.characterName }}</RouterLink>
              </td>
              <td class="wrap">{{ m.reason || '—' }}</td>
              <td :title="m.expiresAt ? `Expires ${formatFull(m.expiresAt)}` : 'No expiry'">
                {{ duration(m) }}
                <div v-if="m.active && m.expiresAt" class="small dim">ends <TimeAgo :value="m.expiresAt" /></div>
              </td>
              <td class="dim">
                <TimeAgo :value="m.createdAt" />
                <div class="small">by {{ m.mutedBy || '—' }}</div>
              </td>
              <td class="actions">
                <button v-if="m.active" type="button" class="btn-sm" :disabled="isBusy(`unmute-${m.id}`)" @click="unmute(m)">Unmute</button>
              </td>
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
