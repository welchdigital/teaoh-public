<script setup>
import { computed } from 'vue';

const props = defineProps({
  status: { type: String, required: true },
  label: { type: String, default: undefined },
  tone: { type: String, default: undefined },
  title: { type: String, default: undefined },
});

const TONES = {
  online: 'green',
  offline: 'dim',
  active: 'red',
  inactive: 'dim',
  expired: 'dim',
  revoked: 'dim',
  banned: 'red',
  locked: 'red',
  unlocked: 'green',
  muted: 'yellow',
  frozen: 'cyan',
  jailed: 'orange',
  hidden: 'purple',
  admin: 'purple',
  staff: 'purple',
  open: 'yellow',
  resolved: 'green',
  report: 'red',
  request: 'blue',
  permanent: 'red',
  pk: 'red',
  spawned: 'orange',
  dead: 'dim',
  evacuating: 'orange',
  ok: 'green',
  error: 'red',
  warn: 'yellow',
  info: 'blue',
  enabled: 'green',
  disabled: 'dim',
  ingame: 'blue',
  api: 'purple',
  completed: 'green',
  'in progress': 'yellow',
};

const toneClass = computed(() => `tone-${props.tone || TONES[props.status] || 'dim'}`);
</script>

<template>
  <span class="badge" :class="toneClass" :title="title">{{ label ?? status }}</span>
</template>
