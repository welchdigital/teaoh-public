import { computed, effectScope, ref } from 'vue';
import { api, usePolling } from '../api.js';
import { useNow } from '../composables/now.js';
import { toDate } from '../util.js';

let store = null;

function createStore() {
  const receivedAt = ref(Date.now());
  const fast = ref(false);
  const poll = usePolling(
    async () => {
      const status = await api.status();
      receivedAt.value = Date.now();
      fast.value = Boolean(status && status.shutdown);
      return status;
    },
    { interval: () => (fast.value ? 2000 : 5000), probe: true },
  );
  const now = useNow(1000);

  const shutdown = computed(() => {
    const info = poll.data.value && poll.data.value.shutdown;
    if (!info) return null;
    let remaining = Number(info.secondsRemaining);
    if (Number.isFinite(remaining)) {
      remaining -= (now.value - receivedAt.value) / 1000;
    } else {
      const at = toDate(info.at);
      remaining = at ? (at.getTime() - now.value) / 1000 : 0;
    }
    return { at: info.at, message: info.message || '', secondsRemaining: Math.max(0, remaining) };
  });

  function applySln(sln) {
    const current = poll.data.value;
    if (current && sln) poll.mutate({ ...current, sln });
  }

  function applyGlobalLock(locked) {
    const current = poll.data.value;
    if (current) poll.mutate({ ...current, globalChatLocked: locked });
  }

  return {
    status: poll.data,
    error: poll.error,
    loading: poll.loading,
    updatedAt: poll.updatedAt,
    refresh: poll.refresh,
    shutdown,
    applySln,
    applyGlobalLock,
  };
}

export function useStatus() {
  if (!store) {
    const scope = effectScope(true);
    store = scope.run(createStore);
  }
  return store;
}
