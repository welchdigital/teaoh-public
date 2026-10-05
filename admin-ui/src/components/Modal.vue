<script>
const stack = [];
</script>

<script setup>
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  width: { type: String, default: '520px' },
  closable: { type: Boolean, default: true },
  zIndex: { type: Number, default: 100 },
});
const emit = defineEmits(['close']);

const panel = ref(null);
const token = {};
let previousFocus = null;

function isTop() {
  return stack[stack.length - 1] === token;
}

function onKey(event) {
  if (event.key !== 'Escape' || !isTop()) return;
  event.stopPropagation();
  if (props.closable) emit('close');
}

function focusInitial() {
  const root = panel.value;
  if (!root) return;
  const target =
    root.querySelector('[data-autofocus]') ||
    root.querySelector('.modal-body input:not([type=hidden]):not([type=checkbox]):not([disabled]), .modal-body textarea:not([disabled]), .modal-body select:not([disabled])') ||
    root.querySelector('.modal-body button:not([disabled])');
  (target || root).focus();
}

function activate() {
  if (stack.includes(token)) return;
  previousFocus = document.activeElement;
  stack.push(token);
  document.addEventListener('keydown', onKey);
  nextTick(focusInitial);
}

function deactivate() {
  const index = stack.indexOf(token);
  if (index === -1) return;
  stack.splice(index, 1);
  document.removeEventListener('keydown', onKey);
  const target = previousFocus;
  previousFocus = null;
  if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
}

watch(
  () => props.open,
  (open) => (open ? activate() : deactivate()),
  { immediate: true },
);
onBeforeUnmount(deactivate);

function onBackdrop() {
  if (props.closable && isTop()) emit('close');
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-backdrop" :style="{ zIndex }" @mousedown.self="onBackdrop">
        <div
          ref="panel"
          class="modal"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          :style="{ maxWidth: width }"
        >
          <div class="modal-head">
            <h3>{{ title }}</h3>
            <button v-if="closable" type="button" class="icon-btn" aria-label="Close" @click="emit('close')">×</button>
          </div>
          <div class="modal-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
