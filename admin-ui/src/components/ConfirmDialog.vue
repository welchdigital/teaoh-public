<script setup>
import { computed, ref, watch } from 'vue';
import Modal from './Modal.vue';
import { confirmState, settleConfirm } from '../stores/confirm.js';

const typed = ref('');

watch(
  () => confirmState.open,
  (open) => {
    if (open) typed.value = '';
  },
);

const canConfirm = computed(
  () => !confirmState.requireText || typed.value.trim() === confirmState.requireText,
);

function submit() {
  if (canConfirm.value) settleConfirm(true);
}
</script>

<template>
  <Modal :open="confirmState.open" :title="confirmState.title" width="460px" :z-index="120" @close="settleConfirm(false)">
    <form @submit.prevent="submit">
      <p class="pre-wrap">{{ confirmState.message }}</p>
      <label v-if="confirmState.requireText" class="field">
        <span>Type <strong class="mono">{{ confirmState.requireText }}</strong> to confirm</span>
        <input v-model="typed" autocomplete="off" spellcheck="false" data-autofocus />
      </label>
      <div class="modal-actions">
        <button
          type="button"
          :data-autofocus="confirmState.danger && !confirmState.requireText ? '' : null"
          @click="settleConfirm(false)"
        >
          {{ confirmState.cancelLabel }}
        </button>
        <button
          type="submit"
          :class="confirmState.danger ? 'btn-danger-solid' : 'btn-accent'"
          :disabled="!canConfirm"
          :data-autofocus="!confirmState.danger && !confirmState.requireText ? '' : null"
        >
          {{ confirmState.confirmLabel }}
        </button>
      </div>
    </form>
  </Modal>
</template>
