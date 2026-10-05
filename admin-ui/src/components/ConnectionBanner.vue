<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { connection, resetConnection, settings } from '../api.js';
import { useNow } from '../composables/now.js';
import { useStatus } from '../stores/status.js';
import { formatCountdown } from '../util.js';

const route = useRoute();
const { refresh } = useStatus();
const now = useNow(1000);
const onSettings = computed(() => route.name === 'settings');
const target = computed(() => settings.baseUrl || 'this origin');
const retryIn = computed(() =>
  connection.retryAt ? Math.max(0, (connection.retryAt - now.value) / 1000) : 0,
);

function retry() {
  resetConnection();
  refresh();
}
</script>

<template>
  <div v-if="connection.state === 'unauthorized'" class="banner banner-err" role="alert">
    <strong>Unauthorized</strong>
    <span class="banner-text">
      The admin API at <span class="mono">{{ target }}</span> rejected the admin key. Live updates are
      paused so repeated failures do not lock you out.
    </span>
    <RouterLink v-if="!onSettings" class="btn btn-sm btn-accent" to="/settings">Open Settings</RouterLink>
    <button type="button" class="btn-sm" @click="retry">Retry</button>
  </div>
  <div v-else-if="connection.state === 'rate-limited'" class="banner banner-err" role="alert">
    <strong>Locked out</strong>
    <span class="banner-text">
      Too many failed authentication attempts from this address, so the server is refusing requests.
      <template v-if="retryIn > 0">
        It will accept them again in
        <strong class="mono countdown">{{ formatCountdown(retryIn) }}</strong>{{ connection.retryAfterKnown ? '' : ' (estimated)' }}.
      </template>
      Check the admin key in Settings before retrying.
    </span>
    <RouterLink v-if="!onSettings" class="btn btn-sm btn-accent" to="/settings">Open Settings</RouterLink>
    <button type="button" class="btn-sm" :disabled="retryIn > 0" @click="retry">
      {{ retryIn > 0 ? `Retry in ${formatCountdown(retryIn)}` : 'Retry now' }}
    </button>
  </div>
  <div v-else-if="connection.state === 'offline'" class="banner banner-err" role="alert">
    <strong>Disconnected</strong>
    <span class="banner-text">{{ connection.message }} Retrying automatically.</span>
    <RouterLink v-if="!onSettings" class="btn btn-sm" to="/settings">Settings</RouterLink>
    <button type="button" class="btn-sm" @click="retry">Retry now</button>
  </div>
</template>
