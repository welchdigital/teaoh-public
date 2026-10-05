<script setup>
import { computed, watch } from 'vue';

const offset = defineModel('offset', { default: 0 });
const limit = defineModel('limit', { default: 50 });
const props = defineProps({
  total: { type: Number, default: 0 },
  sizes: { type: Array, default: () => [25, 50, 100, 200] },
  disabled: { type: Boolean, default: false },
});

const size = computed(() => (limit.value > 0 ? limit.value : 50));
const page = computed(() => Math.floor(offset.value / size.value) + 1);
const pages = computed(() => Math.max(1, Math.ceil(props.total / size.value)));
const from = computed(() => (props.total === 0 ? 0 : Math.min(props.total, offset.value + 1)));
const to = computed(() => Math.min(props.total, offset.value + size.value));

function go(p) {
  const clamped = Math.min(Math.max(1, p), pages.value);
  offset.value = (clamped - 1) * size.value;
}

function setLimit(value) {
  limit.value = value;
  offset.value = 0;
}

watch(
  () => props.total,
  (total) => {
    if (total > 0 && offset.value >= total) go(pages.value);
  },
);
</script>

<template>
  <div class="pagination">
    <span class="dim">
      <template v-if="total">{{ from.toLocaleString() }}–{{ to.toLocaleString() }} of {{ total.toLocaleString() }}</template>
      <template v-else>No results</template>
    </span>
    <div class="row">
      <button type="button" class="btn-sm" aria-label="First page" :disabled="disabled || page <= 1" @click="go(1)">«</button>
      <button type="button" class="btn-sm" :disabled="disabled || page <= 1" @click="go(page - 1)">‹ Prev</button>
      <span class="dim">Page {{ page }} of {{ pages }}</span>
      <button type="button" class="btn-sm" :disabled="disabled || page >= pages" @click="go(page + 1)">Next ›</button>
      <button type="button" class="btn-sm" aria-label="Last page" :disabled="disabled || page >= pages" @click="go(pages)">»</button>
      <select :value="size" aria-label="Rows per page" @change="setLimit(Number($event.target.value))">
        <option v-for="s in sizes" :key="s" :value="s">{{ s }} / page</option>
      </select>
    </div>
  </div>
</template>
