<script setup>
import { computed } from 'vue';
import { useNow } from '../composables/now.js';
import { formatFull, formatRelative, toDate } from '../util.js';

const props = defineProps({
  value: { type: null, default: null },
  empty: { type: String, default: '—' },
});

const now = useNow(15000);
const text = computed(() => (toDate(props.value) ? formatRelative(props.value, now.value) : props.empty));
</script>

<template>
  <time :datetime="toDate(value) ? toDate(value).toISOString() : undefined" :title="formatFull(value)">{{ text }}</time>
</template>
