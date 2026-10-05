<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { formatDateTime, formatFull, prettyJson, textOf } from '../util.js';

const state = useRouteQuery({ q: '', offset: 0, limit: 50 });
const draft = ref(state.q);
const expanded = reactive(new Set());

watch(
  () => state.q,
  (q) => {
    if (q !== draft.value.trim()) draft.value = q;
  },
);

function submitSearch() {
  state.q = draft.value.trim();
  state.offset = 0;
}

function clearSearch() {
  draft.value = '';
  state.q = '';
  state.offset = 0;
}

const poll = usePolling((p) => api.audit(p), {
  params: () => ({ q: state.q, offset: state.offset, limit: state.limit }),
  interval: () => (state.offset === 0 ? 10000 : 0),
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));

const FINGERPRINT_FIELDS = ['keyFingerprint', 'fingerprint', 'keyId'];

function fingerprintOf(entry) {
  for (const field of FINGERPRINT_FIELDS) {
    const value = entry[field];
    if (value !== undefined && value !== null && value !== '') return textOf(value);
  }
  return '';
}

const showFingerprint = computed(() => items.value.some((a) => fingerprintOf(a) !== ''));

const ACTION_TONES = {
  set_admin_level: 'tone-red',
  ban: 'tone-red',
  delete_character: 'tone-red',
  disband_guild: 'tone-red',
  shutdown: 'tone-red',
};

function actionClass(action) {
  return ACTION_TONES[action] || 'tone-dim';
}

function showAdminLevelChanges() {
  draft.value = 'set_admin_level';
  submitSearch();
}

function detailsText(value) {
  const text = textOf(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function isStructured(value) {
  return value !== null && typeof value === 'object';
}

function toggle(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Audit log</h1>
        <div class="subtitle">Every administrative action, in game and through this API. Newest first.</div>
      </div>
    </div>

    <form class="toolbar" role="search" @submit.prevent="submitSearch">
      <input
        v-model="draft"
        type="search"
        class="search-input"
        placeholder="Search actor, action, target, details…"
        aria-label="Search audit log"
      />
      <button type="submit">Search</button>
      <button v-if="state.q" type="button" class="btn-ghost" @click="clearSearch">Clear “{{ state.q }}”</button>
      <button
        type="button"
        class="chip"
        :class="{ on: state.q === 'set_admin_level' }"
        :aria-pressed="state.q === 'set_admin_level'"
        @click="state.q === 'set_admin_level' ? clearSearch() : showAdminLevelChanges()"
      >
        Admin level changes
      </button>
      <span v-if="poll.loading.value" class="spinner sm" aria-label="Loading"></span>
    </form>

    <AsyncState
      :ready="poll.data.value !== null"
      :error="poll.error.value"
      :empty="items.length === 0"
      :empty-text="state.q ? `No audit entries match “${state.q}”.` : 'No audit entries yet.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Source IP</th>
              <th v-if="showFingerprint" title="Fingerprint of the admin key used">Key</th>
              <th>Action</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody v-for="a in items" :key="a.id">
            <tr :class="{ clickable: isStructured(a.details) || textOf(a.details).length > 160, expanded: expanded.has(a.id) }" @click="toggle(a.id)">
              <td class="dim" :title="formatFull(a.at)">{{ formatDateTime(a.at) }}</td>
              <td>
                <StatusBadge :status="a.actorKind || 'api'" />
                <strong style="margin-left: 0.35rem">{{ a.actor || '—' }}</strong>
              </td>
              <td class="mono dim">{{ a.sourceIp || '—' }}</td>
              <td v-if="showFingerprint" class="mono dim small" :title="fingerprintOf(a)">{{ fingerprintOf(a) || '—' }}</td>
              <td><span class="badge plain mono" :class="actionClass(a.action)">{{ a.action }}</span></td>
              <td>{{ textOf(a.target) || '—' }}</td>
              <td class="wrap mono dim small" style="min-width: 200px">{{ detailsText(a.details) || '—' }}</td>
            </tr>
            <tr v-if="expanded.has(a.id)" class="detail-row">
              <td :colspan="showFingerprint ? 7 : 6">
                <pre class="code">{{ isStructured(a.details) ? prettyJson(a.details) : textOf(a.details) }}</pre>
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
