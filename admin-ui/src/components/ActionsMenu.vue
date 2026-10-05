<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';

defineProps({
  items: { type: Array, required: true },
  label: { type: String, default: 'Actions' },
});

const open = ref(false);
const button = ref(null);
const menu = ref(null);
const pos = ref({ top: 0, left: 0 });

function place() {
  if (!button.value) return;
  const rect = button.value.getBoundingClientRect();
  const width = menu.value ? menu.value.offsetWidth : 200;
  const height = menu.value ? menu.value.offsetHeight : 0;
  let left = Math.min(rect.right - width, window.innerWidth - width - 8);
  left = Math.max(8, left);
  let top = rect.bottom + 4;
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 4);
  pos.value = { top, left };
}

function focusables() {
  return menu.value ? [...menu.value.querySelectorAll('button:not([disabled])')] : [];
}

function onOutside(event) {
  if ((menu.value && menu.value.contains(event.target)) || (button.value && button.value.contains(event.target))) return;
  close();
}

function onKey(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    close();
    if (button.value) button.value.focus();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const list = focusables();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % list.length : (index - 1 + list.length) % list.length;
    list[next].focus();
  }
}

function onScroll(event) {
  if (menu.value && menu.value.contains(event.target)) return;
  close();
}

async function show() {
  open.value = true;
  place();
  await nextTick();
  place();
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', close);
  const first = focusables()[0];
  if (first) first.focus();
}

function close() {
  if (!open.value) return;
  open.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', close);
}

function toggle() {
  if (open.value) close();
  else show();
}

function select(item) {
  if (item.disabled) return;
  close();
  item.onSelect();
}

onBeforeUnmount(close);
</script>

<template>
  <span class="menu-anchor">
    <button
      ref="button"
      type="button"
      class="btn-sm"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="toggle"
    >
      {{ label }} ▾
    </button>
    <Teleport to="body">
      <div v-if="open" ref="menu" class="menu" role="menu" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
        <template v-for="(item, i) in items" :key="i">
          <div v-if="item.separator" class="menu-sep" role="separator"></div>
          <button
            v-else
            type="button"
            role="menuitem"
            class="menu-item"
            :class="{ danger: item.danger }"
            :disabled="item.disabled"
            :title="item.hint"
            @click="select(item)"
          >
            {{ item.label }}
          </button>
        </template>
      </div>
    </Teleport>
  </span>
</template>
