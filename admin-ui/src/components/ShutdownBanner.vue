<script setup>
import { api } from '../api.js';
import { useAction } from '../composables/useAction.js';
import { useStatus } from '../stores/status.js';
import { formatCountdown, formatFull } from '../util.js';

const { shutdown, refresh } = useStatus();
const { busy, run } = useAction();

async function cancel() {
  await run(() => api.cancelShutdown(), { success: 'Scheduled shutdown cancelled', failure: 'Cancel failed' });
  refresh();
}
</script>

<template>
  <div v-if="shutdown" class="banner banner-warn" role="status">
    <strong>
      <template v-if="shutdown.secondsRemaining > 0">
        Server shutdown in <span class="mono">{{ formatCountdown(shutdown.secondsRemaining) }}</span>
      </template>
      <template v-else>Server is shutting down…</template>
    </strong>
    <span class="banner-text" :title="formatFull(shutdown.at)">
      <template v-if="shutdown.message">“{{ shutdown.message }}”</template>
      <span v-else class="dim">No message.</span>
    </span>
    <button type="button" class="btn-sm btn-warn" :disabled="!!busy" @click="cancel">
      {{ busy ? 'Cancelling…' : 'Cancel shutdown' }}
    </button>
  </div>
</template>
