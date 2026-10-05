<script setup>
import { computed, reactive } from 'vue';
import { RouterLink } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useAction } from '../composables/useAction.js';
import { useRouteQuery } from '../composables/useRouteQuery.js';

const state = useRouteQuery({ status: 'open', offset: 0, limit: 50 });

const FILTERS = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

function setFilter(value) {
  state.status = value;
  state.offset = 0;
}

const poll = usePolling((p) => api.reports(p), {
  params: () => ({ status: state.status, offset: state.offset, limit: state.limit }),
  interval: 15000,
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));

const { isBusy, run } = useAction();

const resolving = reactive({ report: null, note: '' });

function openResolve(r) {
  resolving.report = r;
  resolving.note = '';
}

async function resolve() {
  const r = resolving.report;
  if (!r) return;
  const result = await run(() => api.resolveReport(r.id, resolving.note), {
    key: `resolve-${r.id}`,
    success: `${r.kind === 'request' ? 'Request' : 'Report'} #${r.id} resolved`,
    failure: 'Resolve failed',
  });
  if (result) {
    resolving.report = null;
    poll.refresh();
  }
}

async function reopen(r) {
  const result = await run(() => api.reopenReport(r.id), {
    key: `reopen-${r.id}`,
    success: `${r.kind === 'request' ? 'Request' : 'Report'} #${r.id} reopened`,
    failure: 'Reopen failed',
  });
  if (result) poll.refresh();
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Reports</h1>
        <div class="subtitle">Player reports and staff requests from the in-game Admin Interact menu.</div>
      </div>
    </div>

    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Report filter">
        <button
          v-for="f in FILTERS"
          :key="f.value"
          type="button"
          role="radio"
          :aria-checked="state.status === f.value"
          :class="{ on: state.status === f.value }"
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
      :empty-text="state.status === 'open' ? 'Inbox zero — no open reports.' : 'No reports found.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>From</th>
              <th>About</th>
              <th>Message</th>
              <th>Received</th>
              <th>Status</th>
              <th class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in items" :key="r.id">
              <td class="mono dim">{{ r.id }}</td>
              <td><StatusBadge :status="r.kind" /></td>
              <td>
                <RouterLink v-if="r.reporter" :to="{ name: 'characters', query: { q: r.reporter } }">{{ r.reporter }}</RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td>
                <RouterLink v-if="r.reportee" :to="{ name: 'characters', query: { q: r.reportee } }">{{ r.reportee }}</RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td class="wrap" style="min-width: 240px; max-width: 520px">
                <div class="pre-wrap">{{ r.message }}</div>
                <div v-if="r.note" class="small dim" style="margin-top: 0.3rem">Note: <span class="pre-wrap">{{ r.note }}</span></div>
              </td>
              <td class="dim"><TimeAgo :value="r.createdAt" /></td>
              <td>
                <StatusBadge :status="r.status" />
                <div v-if="r.status === 'resolved'" class="small dim">
                  by {{ r.resolvedBy || '?' }} · <TimeAgo :value="r.resolvedAt" />
                </div>
              </td>
              <td class="actions">
                <button
                  v-if="r.status === 'open'"
                  type="button"
                  class="btn-sm btn-accent"
                  :disabled="isBusy(`resolve-${r.id}`)"
                  @click="openResolve(r)"
                >
                  Resolve…
                </button>
                <button v-else type="button" class="btn-sm" :disabled="isBusy(`reopen-${r.id}`)" @click="reopen(r)">Reopen</button>
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

    <Modal
      :open="resolving.report !== null"
      :title="resolving.report ? `Resolve ${resolving.report.kind} #${resolving.report.id}` : ''"
      @close="resolving.report = null"
    >
      <form v-if="resolving.report" class="form-stack" @submit.prevent="resolve">
        <div class="panel" style="padding: 0.7rem 0.9rem">
          <div class="small dim">
            {{ resolving.report.reporter || 'unknown' }}
            {{ resolving.report.reportee ? ` → ${resolving.report.reportee}` : '' }}
          </div>
          <div class="pre-wrap">{{ resolving.report.message }}</div>
        </div>
        <label class="field">
          <span>Resolution note (optional)</span>
          <textarea v-model="resolving.note" rows="3" maxlength="500"></textarea>
        </label>
        <div class="modal-actions">
          <button type="button" @click="resolving.report = null">Cancel</button>
          <button type="submit" class="btn-accent" :disabled="isBusy(`resolve-${resolving.report.id}`)">Mark resolved</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
