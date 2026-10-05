<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api.js';
import { itemTypeLabel, npcTypeLabel, textOf } from '../util.js';

const model = defineModel({ default: null });
const props = defineProps({
  kind: { type: String, required: true },
  placeholder: { type: String, default: 'Search by name or id…' },
  limit: { type: Number, default: 25 },
  disabled: { type: Boolean, default: false },
  inputId: { type: String, default: undefined },
});
const emit = defineEmits(['select']);

const FETCHERS = {
  items: api.dataItems,
  npcs: api.dataNpcs,
  spells: api.dataSpells,
};

const query = ref('');
const results = ref([]);
const open = ref(false);
const loading = ref(false);
const error = ref('');
const active = ref(-1);
const selected = ref(null);
const listId = `picker-${Math.random().toString(36).slice(2, 9)}`;
let timer = null;
let seq = 0;

async function search() {
  seq += 1;
  const mine = seq;
  loading.value = true;
  try {
    const list = await FETCHERS[props.kind]({ q: query.value.trim() || undefined, limit: props.limit });
    if (mine !== seq) return;
    results.value = Array.isArray(list) ? list : [];
    error.value = '';
    active.value = results.value.length ? 0 : -1;
  } catch (err) {
    if (mine !== seq) return;
    results.value = [];
    error.value = err.message || String(err);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

function onInput() {
  open.value = true;
  clearTimeout(timer);
  timer = setTimeout(search, 220);
}

function onFocus() {
  open.value = true;
  if (!results.value.length && !loading.value) search();
}

function pick(entry) {
  selected.value = entry;
  model.value = entry.id;
  emit('select', entry);
  open.value = false;
  query.value = '';
}

function clearSelection() {
  selected.value = null;
  model.value = null;
  emit('select', null);
}

function onKeydown(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    open.value = true;
    if (results.value.length) active.value = (active.value + 1) % results.value.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (results.value.length) active.value = (active.value - 1 + results.value.length) % results.value.length;
  } else if (event.key === 'Enter') {
    if (open.value && results.value[active.value]) {
      event.preventDefault();
      pick(results.value[active.value]);
    }
  } else if (event.key === 'Escape') {
    if (open.value) {
      event.stopPropagation();
      open.value = false;
    }
  }
}

function meta(entry) {
  if (props.kind === 'items') return itemTypeLabel(entry.type);
  if (props.kind === 'npcs') {
    const parts = [];
    if (entry.level !== undefined && entry.level !== null) parts.push(`lvl ${entry.level}`);
    if (entry.hp !== undefined && entry.hp !== null) parts.push(`${entry.hp} hp`);
    const type = npcTypeLabel(entry.type);
    if (type) parts.push(type);
    return parts.join(' · ');
  }
  return textOf(entry.type);
}

watch(model, (value) => {
  if (value === null || value === undefined || value === '') selected.value = null;
  else if (!selected.value || selected.value.id !== value) selected.value = { id: value, name: `#${value}` };
}, { immediate: true });

const activeId = computed(() => (active.value >= 0 ? `${listId}-${active.value}` : undefined));

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="picker">
    <div v-if="selected" class="picker-selected">
      <span class="name">{{ selected.name }}</span>
      <span class="mono dim">#{{ selected.id }}</span>
      <button type="button" class="icon-btn" aria-label="Clear selection" :disabled="disabled" @click="clearSelection">×</button>
    </div>
    <input
      v-else
      :id="inputId"
      v-model="query"
      type="search"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      aria-autocomplete="list"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open ? activeId : undefined"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="onInput"
      @focus="onFocus"
      @blur="open = false"
      @keydown="onKeydown"
    />
    <ul v-if="open && !selected" :id="listId" class="picker-list" role="listbox">
      <li v-if="loading && !results.length" class="note"><span class="spinner sm"></span> Searching…</li>
      <li v-else-if="error" class="note err">{{ error }}</li>
      <li v-else-if="!results.length" class="note">No matches</li>
      <template v-else>
        <li
          v-for="(r, i) in results"
          :id="`${listId}-${i}`"
          :key="r.id"
          role="option"
          :aria-selected="i === active"
          :class="{ active: i === active }"
          @mousedown.prevent="pick(r)"
          @mouseenter="active = i"
        >
          <span>{{ r.name }}</span>
          <span class="mono dim">#{{ r.id }}</span>
          <span class="meta">{{ meta(r) }}</span>
        </li>
      </template>
    </ul>
  </div>
</template>
