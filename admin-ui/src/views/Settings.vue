<script setup>
import { computed, reactive, ref } from 'vue';
import { normalizeBaseUrl, sanitizeActor, saveSettings, settings, testConnection } from '../api.js';
import { useStatus } from '../stores/status.js';
import { toast } from '../stores/toasts.js';

const form = reactive({ baseUrl: settings.baseUrl, key: settings.key, actor: settings.actor });
const showKey = ref(false);
const testing = ref(false);
const result = ref(null);
const { refresh: refreshStatus } = useStatus();

const actorClean = computed(() => sanitizeActor(form.actor));
const actorWarning = computed(() => {
  const raw = form.actor.trim();
  if (!raw || actorClean.value === raw) return '';
  return `Only printable ASCII is sent (max 32 characters): it will be recorded as “${actorClean.value}”.`;
});

const urlError = computed(() => {
  const url = normalizeBaseUrl(form.baseUrl);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Use an http:// or https:// URL.';
    return '';
  } catch {
    return 'Enter a full URL such as http://127.0.0.1:8080, or leave blank for same origin.';
  }
});

const dirty = computed(
  () =>
    normalizeBaseUrl(form.baseUrl) !== settings.baseUrl ||
    form.key !== settings.key ||
    actorClean.value !== settings.actor,
);

function persist() {
  saveSettings(form);
  form.baseUrl = settings.baseUrl;
  form.actor = settings.actor;
}

function save() {
  if (urlError.value) return;
  persist();
  if (settings.key || settings.keyless) {
    toast.success('Settings saved');
    refreshStatus();
  } else {
    toast.info('Saved. Add the admin key, or test a key-less connection, to start.');
  }
}

async function test() {
  if (urlError.value) return;
  persist();
  testing.value = true;
  result.value = null;
  try {
    const s = await testConnection();
    result.value = {
      ok: true,
      text: `Connected to ${s.name || 'teaoh'} ${s.version || ''}: ${s.online}/${s.maxPlayers} online, ${s.maps} maps, ${s.database || 'unknown'} database.${settings.key ? '' : ' This server accepts requests without a key; the panel will remember that.'}`,
    };
    refreshStatus();
  } catch (err) {
    result.value = { ok: false, text: err.message || String(err) };
  } finally {
    testing.value = false;
  }
}

function forgetKey() {
  form.key = '';
  persist();
  toast.info('Admin key removed from this browser');
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Settings</h1>
        <div class="subtitle">Connection to the teaoh admin API.</div>
      </div>
    </div>

    <div class="stack" style="max-width: 640px">
      <form class="panel form-stack" @submit.prevent="save">
        <div class="panel-head"><h3>Admin API connection</h3></div>

        <label class="field">
          <span>API base URL</span>
          <input
            v-model="form.baseUrl"
            placeholder="(same origin) e.g. http://127.0.0.1:8080"
            autocomplete="url"
            spellcheck="false"
            :class="{ invalid: urlError }"
          />
          <span v-if="urlError" class="hint err">{{ urlError }}</span>
          <span v-else class="hint">Leave blank when the server serves this UI itself. Set it when using the Vite dev server.</span>
        </label>

        <label class="field">
          <span>Admin key</span>
          <div class="row nowrap">
            <input
              v-model="form.key"
              class="grow mono"
              :type="showKey ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
              placeholder="(none)"
            />
            <button type="button" class="btn-sm" :aria-pressed="showKey" @click="showKey = !showKey">
              {{ showKey ? 'Hide' : 'Show' }}
            </button>
          </div>
          <span class="hint">
            Sent as the <span class="mono">x-admin-key</span> header. Nothing is requested until a key is saved; for a
            key-less loopback server, leave it blank and use Test connection.
          </span>
        </label>

        <label class="field">
          <span>Operator name</span>
          <input v-model="form.actor" maxlength="64" autocomplete="nickname" placeholder="e.g. your staff name" />
          <span v-if="actorWarning" class="hint warn-text">{{ actorWarning }}</span>
          <span v-else class="hint">
            Sent as <span class="mono">x-admin-actor</span> and recorded in the audit log. Without it, actions are logged as “api”.
          </span>
        </label>

        <div class="form-actions">
          <button type="submit" class="btn-accent" :disabled="Boolean(urlError)">Save</button>
          <button type="button" :disabled="Boolean(urlError) || testing" @click="test">
            <span v-if="testing" class="spinner sm"></span> Test connection
          </button>
          <span v-if="dirty" class="hint warn-text">Unsaved changes</span>
        </div>

        <div v-if="result" class="banner" :class="result.ok ? 'banner-info' : 'banner-err'" role="status" style="margin: 0">
          <strong>{{ result.ok ? 'OK' : 'Failed' }}</strong>
          <span class="banner-text">{{ result.text }}</span>
        </div>
      </form>

      <section class="panel">
        <div class="panel-head"><h3>Storage</h3></div>
        <p class="dim">
          The API URL, admin key and operator name are stored in this browser's localStorage, readable by
          anyone with access to this browser profile. Use a private profile on shared machines and remove
          the key when you are done.
        </p>
        <button type="button" class="btn-danger" :disabled="!settings.key" @click="forgetKey">Forget admin key</button>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>About</h3></div>
        <p class="dim" style="margin: 0">
          teaoh administration interface. Live views poll the server and pause while this tab is hidden.
          After an authentication failure polling stops until the key is updated, to avoid triggering the
          server's lockout.
        </p>
      </section>
    </div>
  </div>
</template>
