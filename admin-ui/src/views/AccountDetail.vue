<script setup>
import { computed, reactive, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useAction } from '../composables/useAction.js';
import { usePageTitle } from '../composables/usePageTitle.js';
import { toast } from '../stores/toasts.js';
import { copyText, formatDateTime, formatFull, formatMinutes, generatePassword, toDate } from '../util.js';

const route = useRoute();
const id = computed(() => Number(route.params.id));
const poll = usePolling((aid) => api.account(aid), { params: id, interval: 15000, resetOnChange: true });
const account = poll.data;
const notFound = computed(() => !account.value && poll.error.value && poll.error.value.status === 404);

usePageTitle(() => (account.value ? `${account.value.name} · Account` : ''));

const { isBusy, run } = useAction();

const bans = computed(() => (account.value && Array.isArray(account.value.bans) ? account.value.bans : []));
const logins = computed(() => (account.value && Array.isArray(account.value.logins) ? account.value.logins : []));
const characters = computed(() => (account.value && Array.isArray(account.value.characters) ? account.value.characters : []));
const onlineCount = computed(() => characters.value.filter((c) => c.online).length);

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
  return formatMinutes(Math.round((end - start) / 60000));
}

async function revoke(b) {
  const result = await run(() => api.revokeBan(b.id), {
    key: `revoke-${b.id}`,
    confirm: {
      title: 'Revoke ban',
      message: `Lift ban #${b.id} on ${b.characterName || b.accountName || b.ip}?`,
      confirmLabel: 'Revoke',
    },
    success: `Ban #${b.id} revoked`,
    failure: 'Revoke failed',
  });
  if (result) poll.refresh();
}

const lockReason = ref('');

async function lock() {
  const a = account.value;
  const result = await run(() => api.lockAccount(a.id, lockReason.value), {
    key: 'lock',
    confirm: {
      title: 'Lock account',
      message: `Lock account ${a.name}? It will not be able to log in until unlocked.${onlineCount.value ? `\n${onlineCount.value} online character(s) will be kicked.` : ''}`,
      confirmLabel: 'Lock account',
      danger: true,
    },
    success: `Account ${a.name} locked`,
    failure: 'Lock failed',
  });
  if (result) {
    lockReason.value = '';
    poll.refresh();
  }
}

async function unlock() {
  const a = account.value;
  const result = await run(() => api.unlockAccount(a.id), {
    key: 'unlock',
    success: `Account ${a.name} unlocked`,
    failure: 'Unlock failed',
  });
  if (result) poll.refresh();
}

const password = reactive({ value: '', visible: false });
const passwordError = computed(() => {
  const len = password.value.length;
  if (!len) return '';
  if (len < 6 || len > 64) return 'Password must be 6–64 characters.';
  return '';
});

function generate() {
  password.value = generatePassword(14);
  password.visible = true;
}

async function copyPassword() {
  if (!password.value) return;
  const ok = await copyText(password.value);
  if (ok) toast.success('Password copied to clipboard');
  else toast.error('Copy failed. Select the password and copy it manually.');
}

async function resetPassword() {
  if (!password.value || passwordError.value) return;
  const a = account.value;
  const result = await run(() => api.setAccountPassword(a.id, password.value), {
    key: 'password',
    confirm: {
      title: 'Reset password',
      message: `Set a new password for ${a.name}? Remembered logins on this account will be signed out.`,
      confirmLabel: 'Reset password',
      danger: true,
    },
    success: `Password for ${a.name} reset. Share it with the player securely.`,
    failure: 'Password reset failed',
  });
  if (result) poll.refresh();
}
</script>

<template>
  <div>
    <RouterLink class="back-link" :to="{ name: 'accounts' }">← Accounts</RouterLink>

    <div v-if="notFound" class="panel state">
      <strong>Account #{{ route.params.id }} was not found.</strong>
      <RouterLink :to="{ name: 'accounts' }">Back to account search</RouterLink>
    </div>

    <AsyncState v-else :ready="Boolean(account)" :error="poll.error.value" @retry="poll.refresh">
      <template v-if="account">
        <div class="page-header">
          <div>
            <div class="page-title">
              <h1>{{ account.name }}</h1>
              <StatusBadge :status="account.online ? 'online' : 'offline'" />
              <StatusBadge v-if="account.locked" status="locked" />
              <StatusBadge v-if="bans.some((b) => b.active)" status="banned" />
            </div>
            <div class="subtitle">Account #{{ account.id }} · created {{ formatDateTime(account.createdAt) }}</div>
          </div>
          <div class="row">
            <RouterLink class="btn btn-danger" :to="{ name: 'bans', query: { new: '1', accountId: String(account.id) } }">Ban account…</RouterLink>
            <button type="button" class="btn-sm" :disabled="poll.loading.value" @click="poll.refresh">Refresh</button>
          </div>
        </div>

        <div class="grid-2">
          <div class="stack">
            <section class="panel">
              <div class="panel-head"><h3>Profile</h3></div>
              <dl class="kv">
                <dt>Email</dt>
                <dd>{{ account.email || '—' }}</dd>
                <dt>Real name</dt>
                <dd>{{ account.realName || '—' }}</dd>
                <dt>Location</dt>
                <dd>{{ account.location || '—' }}</dd>
                <dt>Computer</dt>
                <dd>{{ account.computer || '—' }}</dd>
                <dt>HDID</dt>
                <dd class="mono">{{ account.hdid || '—' }}</dd>
                <dt>Created</dt>
                <dd><span :title="formatFull(account.createdAt)">{{ formatDateTime(account.createdAt) }}</span></dd>
                <dt>Last login</dt>
                <dd><TimeAgo :value="account.lastLoginAt" empty="never" /></dd>
                <dt>Last IP</dt>
                <dd class="mono">{{ account.lastIp || '—' }}</dd>
              </dl>
            </section>

            <section class="panel">
              <div class="panel-head"><h3>Characters <span class="dim">({{ characters.length }})</span></h3></div>
              <table v-if="characters.length" class="table-compact">
                <tbody>
                  <tr v-for="c in characters" :key="c.id">
                    <td><RouterLink :to="{ name: 'character', params: { id: c.id } }">{{ c.name }}</RouterLink></td>
                    <td class="dim">level {{ c.level }}</td>
                    <td class="actions"><StatusBadge :status="c.online ? 'online' : 'offline'" /></td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="dim">No characters.</div>
            </section>

            <section class="panel" :class="{ 'panel-danger': account.locked }">
              <div class="panel-head">
                <h3>Lock</h3>
                <StatusBadge :status="account.locked ? 'locked' : 'unlocked'" />
              </div>
              <template v-if="account.locked">
                <p>
                  This account is locked<template v-if="account.lockReason">: <span class="pre-wrap">“{{ account.lockReason }}”</span></template>.
                </p>
                <button type="button" class="btn-accent" :disabled="isBusy('unlock')" @click="unlock">Unlock account</button>
              </template>
              <form v-else class="form-stack" @submit.prevent="lock">
                <label class="field">
                  <span>Reason (optional)</span>
                  <input v-model="lockReason" maxlength="200" />
                </label>
                <div class="form-actions">
                  <button type="submit" class="btn-danger" :disabled="isBusy('lock')">Lock account…</button>
                  <span class="hint">Locking kicks any online characters.</span>
                </div>
              </form>
            </section>

            <section class="panel">
              <div class="panel-head"><h3>Reset password</h3></div>
              <form class="form-stack" @submit.prevent="resetPassword">
                <input type="text" name="username" autocomplete="username" :value="account.name" readonly hidden />
                <label class="field">
                  <span>New password (6–64 characters)</span>
                  <div class="row nowrap">
                    <input
                      v-model="password.value"
                      class="grow mono"
                      :type="password.visible ? 'text' : 'password'"
                      autocomplete="new-password"
                      spellcheck="false"
                      maxlength="64"
                      :class="{ invalid: passwordError }"
                    />
                    <button type="button" class="btn-sm" @click="password.visible = !password.visible">
                      {{ password.visible ? 'Hide' : 'Show' }}
                    </button>
                  </div>
                </label>
                <div v-if="passwordError" class="hint err">{{ passwordError }}</div>
                <div class="form-actions">
                  <button type="button" @click="generate">Generate</button>
                  <button type="button" :disabled="!password.value" @click="copyPassword">Copy</button>
                  <button type="submit" class="btn-danger" :disabled="!password.value || Boolean(passwordError) || isBusy('password')">
                    Reset password…
                  </button>
                </div>
                <div class="hint">Also clears remember-me sessions. The password is never stored by this page.</div>
              </form>
            </section>
          </div>

          <div class="stack">
            <section class="panel">
              <div class="panel-head">
                <h3>Bans <span class="dim">({{ bans.length }})</span></h3>
                <RouterLink :to="{ name: 'bans' }" class="small">All bans →</RouterLink>
              </div>
              <div v-if="bans.length" class="table-wrap plain">
                <table class="table-compact">
                  <thead>
                    <tr><th>#</th><th>State</th><th>Target</th><th>Reason</th><th>Duration</th><th>By</th><th></th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="b in bans" :key="b.id">
                      <td class="mono dim">{{ b.id }}</td>
                      <td>
                        <StatusBadge
                          :status="banState(b)"
                          :title="b.revokedAt ? `Revoked by ${b.revokedBy || '?'} ${formatFull(b.revokedAt)}` : undefined"
                        />
                      </td>
                      <td class="small">
                        <div v-if="b.characterName">{{ b.characterName }}</div>
                        <div v-if="b.ip" class="mono dim">{{ b.ip }}</div>
                      </td>
                      <td class="wrap">{{ b.reason || '—' }}</td>
                      <td class="dim" :title="b.expiresAt ? `Expires ${formatFull(b.expiresAt)}` : 'Never expires'">
                        {{ banDuration(b) }}
                        <div v-if="b.active && b.expiresAt" class="small"><TimeAgo :value="b.expiresAt" /></div>
                      </td>
                      <td class="dim">{{ b.bannedBy || '—' }}<div class="small"><TimeAgo :value="b.createdAt" /></div></td>
                      <td class="actions">
                        <button v-if="b.active" type="button" class="btn-sm" :disabled="isBusy(`revoke-${b.id}`)" @click="revoke(b)">Revoke</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="dim">No bans on record.</div>
            </section>

            <section class="panel">
              <div class="panel-head"><h3>Login history <span class="dim">({{ logins.length }})</span></h3></div>
              <div v-if="logins.length" class="table-wrap plain" style="max-height: 460px">
                <table class="table-compact">
                  <thead>
                    <tr><th>When</th><th>Event</th><th>IP</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(l, i) in logins" :key="`${l.at}-${i}`">
                      <td :title="formatFull(l.at)">{{ formatDateTime(l.at) }}</td>
                      <td>{{ l.event }}</td>
                      <td class="mono dim">{{ l.ip }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-else class="dim">No logins recorded.</div>
            </section>
          </div>
        </div>
      </template>
    </AsyncState>
  </div>
</template>
