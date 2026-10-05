<script setup>
import DataPicker from './DataPicker.vue';

const model = defineModel({ default: null });
defineProps({
  placeholder: { type: String, default: 'Search items by name or id…' },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);
</script>

<template>
  <DataPicker v-model="model" kind="items" :placeholder="placeholder" :disabled="disabled" @select="emit('select', $event)" />
</template>
