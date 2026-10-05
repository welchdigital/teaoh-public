<script setup>
import { computed, reactive, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import DurationPicker from '../components/DurationPicker.vue';
import Modal from '../components/Modal.vue';
import Pagination from '../components/Pagination.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useAction } from '../composables/useAction.js';
import { useRouteQuery } from '../composables/useRouteQuery.js';
import { formatFull, formatMinutes, toDate, toInt } from '../util.js';

const route = useRoute();
const router = useRouter();
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

const poll = usePolling((p) => api.bans(p), {
  params: () => ({ active: state.active, offset: state.offset, limit: state.limit }),
  interval: 20000,
});

const items = computed(() => (poll.data.value && Array.isArray(poll.data.value.items) ? poll.data.value.items : []));
const total = computed(() => (poll.data.value ? Number(poll.data.value.total) || 0 : 0));

const { isBusy, errorFor, clearError, run } = useAction();

const ipInvolved = computed(() => form.target === 'ip' || form.banIp);

function banState(b) {
  if (b.active) return 'active';
  if (b.revokedAt) return 'revoked';
  return 'expired';
}

function banDuration(b) {
  const start = toDate(b.createdAt);
  const end = toDate(b.expiresAt);
  if (!end) return 'permanent';
  if (!start) return '—';
  return formatMinutes(Math.max(1, Math.round((end - start) / 60000)));
}

function targetLabel(b) {
  return b.characterName || b.accountName || b.ip || `ban #${b.id}`;
}

async function revoke(b) {
  const result = await run(() => api.revokeBan(b.id), {
    key: `revoke-${b.id}`,
    confirm: {
      title: 'Revoke ban',
      message: `Lift ban #${b.id} on ${targetLabel(b)}?`,
      confirmLabel: 'Revoke ban',
    },
    success: `Ban #${b.id} revoked`,
    failure: 'Revoke failed',
  });
  if (result) poll.refresh();
}

const TARGETS = [
  { value: 'character', label: 'Character name' },
  { value: 'account', label: 'Account id' },
  { value: 'ip', label: 'IP address' },
];

const form = reactive({
  open: false,
  target: 'character',
  characterName: '',
  accountId: '',
  ip: '',
  duration: 1440,
  durationValid: true,
  reason: '',
  banIp: false,
  banHdid: false,
  silent: false,
  force: false,
});

function openForm(prefill = {}) {
  Object.assign(form, {
    target: 'character',
    characterName: '',
    accountId: '',
    ip: '',
    duration: 1440,
    durationValid: true,
    reason: '',
    banIp: false,
    banHdid: false,
    silent: false,
    force: false,
  });
  clearError('create');
  const first = (value) => (Array.isArray(value) ? value[0] : value);
  const characterName = first(prefill.characterName);
  const accountId = first(prefill.accountId);
  const ip = first(prefill.ip);
  if (characterName) {
    form.target = 'character';
    form.characterName = String(characterName);
  } else if (accountId) {
    form.target = 'account';
    form.accountId = String(accountId);
  } else if (ip) {
    form.target = 'ip';
    form.ip = String(ip);
  }
  form.open = true;
}

function closeForm() {
  form.open = false;
  if (route.query.new) {
    const query = { ...route.query };
    delete query.new;
    delete query.characterName;
    delete query.accountId;
    delete query.ip;
    router.replace({ query });
  }
}

watch(
  () => route.query.new,
  (value) => {
    if (value && !form.open) {
      openForm({
        characterName: route.query.characterName,
        accountId: route.query.accountId,
        ip: route.query.ip,
      });
    }
  },
  { immediate: true },
);

const formError = computed(() => {
  if (form.target === 'character' && !form.characterName.trim()) return 'Enter a character name.';
  if (form.target === 'account') {
    const id = toInt(form.accountId);
    if (id === null || id < 1) return 'Enter a numeric account id.';
  }
  if (form.target === 'ip' && !form.ip.trim()) return 'Enter an IP address.';
  if (!form.durationValid) return 'Choose a valid duration.';
  return '';
});

async function submitBan() {
  if (formError.value) return;
  const payload = {
    durationMinutes: form.duration,
    reason: form.reason.trim(),
    silent: form.silent,
  };
  let label = '';
  if (form.target === 'character') {
    payload.characterName = form.characterName.trim();
    payload.banIp = form.banIp;
    payload.banHdid = form.banHdid;
    label = `character ${payload.characterName}`;
  } else if (form.target === 'account') {
    payload.accountId = toInt(form.accountId);
    payload.banIp = form.banIp;
    payload.banHdid = form.banHdid;
    label = `account #${payload.accountId}`;
  } else {
    payload.ip = form.ip.trim();
    label = `IP ${payload.ip}`;
  }
  payload.force = ipInvolved.value && form.force;
  const extras = [payload.banIp && 'their IP address', payload.banHdid && 'their hardware ID'].filter(Boolean);
  const durationText = form.duration === null ? 'permanently' : `for ${formatMinutes(form.duration)}`;
  const result = await run(() => api.createBan(payload), {
    key: 'create',
    confirm: {
      title: 'Create ban',
      message: `Ban ${label} ${durationText}${extras.length ? `, including ${extras.join(' and ')}` : ''}?${payload.reason ? `\nReason: ${payload.reason}` : ''}${payload.force ? '\nForce: loopback and proxy address checks are skipped.' : ''}\nOnline targets are disconnected.`,
      confirmLabel: 'Ban',
      danger: true,
    },
    success: (b) => `Ban #${b && b.id !== undefined ? b.id : ''} created for ${label}`,
    failure: 'Ban failed',
  });
  if (result) {
    closeForm();
    if (state.active === 'false') setFilter('true');
    poll.refresh();
  }
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Bans</h1>
        <div class="subtitle">Account, character and IP bans.</div>
      </div>
      <button type="button" class="btn-danger" @click="openForm()">New ban…</button>
    </div>

    <div class="toolbar">
      <div class="segmented" role="radiogroup" aria-label="Ban filter">
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
      :empty-text="state.active === 'true' ? 'No active bans.' : 'No bans found.'"
      @retry="poll.refresh"
    >
      <div class="table-wrap tall">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>State</th>
              <th>Character</th>
              <th>Account</th>
              <th>IP / HDID</th>
              <th>Reason</th>
              <th>Duration</th>
              <th>Banned</th>
              <th class="actions"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in items" :key="b.id">
              <td class="mono dim">{{ b.id }}</td>
              <td>
                <StatusBadge
                  :status="banState(b)"
                  :title="b.revokedAt ? `Revoked by ${b.revokedBy || '?'} · ${formatFull(b.revokedAt)}` : undefined"
                />
              </td>
              <td>
                <RouterLink v-if="b.characterName" :to="{ name: 'characters', query: { q: b.characterName } }">{{ b.characterName }}</RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td>
                <RouterLink v-if="b.accountId !== null && b.accountId !== undefined" :to="{ name: 'account', params: { id: b.accountId } }">
                  {{ b.accountName || `#${b.accountId}` }}
                </RouterLink>
                <span v-else class="dim">—</span>
              </td>
              <td class="mono dim small">
                <div>{{ b.ip || '—' }}</div>
                <div v-if="b.hdid">{{ b.hdid }}</div>
              </td>
              <td class="wrap" style="min-width: 160px">{{ b.reason || '—' }}</td>
              <td :title="b.expiresAt ? `Expires ${formatFull(b.expiresAt)}` : 'Never expires'">
                {{ banDuration(b) }}
                <div v-if="b.active && b.expiresAt" class="small dim">ends <TimeAgo :value="b.expiresAt" /></div>
                <div v-else-if="b.revokedAt" class="small dim">revoked by {{ b.revokedBy || '?' }}</div>
              </td>
              <td class="dim">
                <TimeAgo :value="b.createdAt" />
                <div class="small">by {{ b.bannedBy || '—' }}</div>
              </td>
              <td class="actions">
                <button v-if="b.active" type="button" class="btn-sm" :disabled="isBusy(`revoke-${b.id}`)" @click="revoke(b)">Revoke…</button>
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

    <Modal :open="form.open" title="New ban" width="560px" @close="closeForm">
      <form class="form-stack" @submit.prevent="submitBan">
        <div class="field">
          <span class="field-label">Target</span>
          <div class="segmented" role="radiogroup" aria-label="Ban target">
            <button
              v-for="t in TARGETS"
              :key="t.value"
              type="button"
              role="radio"
              :aria-checked="form.target === t.value"
              :class="{ on: form.target === t.value }"
              @click="form.target = t.value"
            >
              {{ t.label }}
            </button>
          </div>
        </div>
        <label v-if="form.target === 'character'" class="field">
          <span>Character name</span>
          <input v-model="form.characterName" autocomplete="off" spellcheck="false" placeholder="Works for offline characters" />
        </label>
        <label v-else-if="form.target === 'account'" class="field">
          <span>Account id</span>
          <input v-model="form.accountId" type="number" min="1" step="1" />
        </label>
        <label v-else class="field">
          <span>IP address</span>
          <input v-model="form.ip" class="mono" autocomplete="off" spellcheck="false" placeholder="1.2.3.4" />
        </label>
        <div class="field">
          <span class="field-label">Duration</span>
          <DurationPicker v-model="form.duration" v-model:valid="form.durationValid" />
        </div>
        <label class="field">
          <span>Reason</span>
          <input v-model="form.reason" maxlength="200" />
        </label>
        <template v-if="form.target !== 'ip'">
          <label class="check"><input v-model="form.banIp" type="checkbox" /> Also ban the IP address</label>
          <label class="check"><input v-model="form.banHdid" type="checkbox" /> Also ban the hardware ID</label>
        </template>
        <label class="check"><input v-model="form.silent" type="checkbox" /> Silent (no in-game announcement)</label>
        <details v-if="ipInvolved" class="advanced">
          <summary>Advanced</summary>
          <label class="check">
            <input v-model="form.force" type="checkbox" /> Force the IP ban even for loopback or proxy addresses
          </label>
          <div class="hint">
            The server refuses to ban loopback and proxy addresses unless forced, because that can lock out everyone
            who connects through them.
          </div>
        </details>
        <div v-if="formError" class="hint err">{{ formError }}</div>
        <div v-else-if="errorFor('create')" class="hint err" role="alert">{{ errorFor('create') }}</div>
        <div class="modal-actions">
          <button type="button" @click="closeForm">Cancel</button>
          <button type="submit" class="btn-danger-solid" :disabled="Boolean(formError) || isBusy('create')">Ban…</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
