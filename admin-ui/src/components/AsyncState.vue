<script setup>
import { computed } from 'vue';

const props = defineProps({
  loading: { type: Boolean, default: false },
  error: { type: null, default: null },
  ready: { type: Boolean, default: true },
  empty: { type: Boolean, default: false },
  emptyText: { type: String, default: 'Nothing to show.' },
});
const emit = defineEmits(['retry']);

const message = computed(() => {
  const err = props.error;
  if (!err) return '';
  return typeof err === 'string' ? err : err.message || String(err);
});
</script>

<template>
  <div class="async-state">
    <div v-if="!ready && error" class="state state-error" role="alert">
      <div>{{ message }}</div>
      <button type="button" class="btn-sm" @click="emit('retry')">Retry</button>
    </div>
    <div v-else-if="!ready" class="state" aria-busy="true">
      <span class="spinner"></span>
      <span>Loading…</span>
    </div>
    <template v-else>
      <div v-if="error" class="inline-error" role="alert">
        <span>Showing last known data. {{ message }}</span>
        <button type="button" class="btn-sm btn-ghost" @click="emit('retry')">Retry</button>
      </div>
      <slot v-if="empty" name="empty">
        <div class="state">{{ emptyText }}</div>
      </slot>
      <slot v-else />
    </template>
  </div>
</template>
