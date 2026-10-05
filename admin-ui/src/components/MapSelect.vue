<script setup>
import { useMapList } from '../stores/lookups.js';

const model = defineModel({ default: null });
defineProps({
  allowAll: { type: Boolean, default: false },
  allLabel: { type: String, default: 'All maps' },
  disabled: { type: Boolean, default: false },
});

const { maps } = useMapList();
</script>

<template>
  <select v-if="maps && maps.length" v-model="model" :disabled="disabled">
    <option v-if="allowAll" :value="null">{{ allLabel }}</option>
    <option v-else-if="model === null" :value="null" disabled>Select a map…</option>
    <option v-for="m in maps" :key="m.id" :value="m.id">{{ m.id }} · {{ m.name || 'unnamed' }}</option>
  </select>
  <input
    v-else
    v-model.number="model"
    type="number"
    min="1"
    :placeholder="allowAll ? 'Map id (blank = all)' : 'Map id'"
    :disabled="disabled"
  />
</template>
