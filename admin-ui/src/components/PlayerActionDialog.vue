<script setup>
import { computed, reactive, watch } from 'vue';
import DurationPicker from './DurationPicker.vue';
import MapSelect from './MapSelect.vue';
import Modal from './Modal.vue';
import { toInt } from '../util.js';

const props = defineProps({
  action: { type: String, default: null },
  target: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['close', 'submit']);

const TITLES = { message: 'Send private message', warp: 'Warp character', mute: 'Mute character' };

const form = reactive({
  message: '',
  map: null,
  x: '',
  y: '',
  duration: 60,
  durationValid: true,
  reason: '',
});

watch(
  () => [props.action, props.target && props.target.id],
  () => {
    if (!props.action || !props.target) return;
    form.message = '';
    form.map = props.target.map ?? null;
    form.x = '';
    form.y = '';
    form.duration = 60;
    form.durationValid = true;
    form.reason = '';
  },
  { immediate: true },
);

const coordsError = computed(() => {
  const hasX = form.x !== '' && form.x !== null;
  const hasY = form.y !== '' && form.y !== null;
  if (hasX !== hasY) return 'Enter both X and Y, or leave both blank.';
  if (hasX && (toInt(form.x) === null || toInt(form.x) < 0 || toInt(form.y) === null || toInt(form.y) < 0)) {
    return 'Coordinates must be whole numbers ≥ 0.';
  }
  return '';
});

const canSubmit = computed(() => {
  if (props.busy) return false;
  if (props.action === 'message') return form.message.trim().length > 0;
  if (props.action === 'warp') return toInt(form.map) !== null && toInt(form.map) > 0 && !coordsError.value;
  if (props.action === 'mute') return form.durationValid;
  return false;
});

function submit() {
  if (!canSubmit.value) return;
  if (props.action === 'message') {
    emit('submit', { message: form.message.trim() });
  } else if (props.action === 'warp') {
    const hasCoords = form.x !== '' && form.x !== null;
    emit('submit', {
      map: toInt(form.map),
      x: hasCoords ? toInt(form.x) : null,
      y: hasCoords ? toInt(form.y) : null,
    });
  } else if (props.action === 'mute') {
    emit('submit', { durationMinutes: form.duration, reason: form.reason.trim() });
  }
}
</script>

<template>
  <Modal
    :open="Boolean(action && target)"
    :title="target ? `${TITLES[action] || ''} · ${target.name}` : ''"
    @close="emit('close')"
  >
    <form v-if="target" class="form-stack" @submit.prevent="submit">
      <template v-if="action === 'message'">
        <label class="field">
          <span>Message (sent as a server private message)</span>
          <textarea v-model="form.message" maxlength="200" rows="3" required></textarea>
          <span class="counter">{{ form.message.length }} / 200</span>
        </label>
      </template>

      <template v-else-if="action === 'warp'">
        <label class="field">
          <span>Destination map</span>
          <MapSelect v-model="form.map" />
        </label>
        <div class="form-grid">
          <label class="field">
            <span>X (optional)</span>
            <input v-model="form.x" type="number" min="0" inputmode="numeric" />
          </label>
          <label class="field">
            <span>Y (optional)</span>
            <input v-model="form.y" type="number" min="0" inputmode="numeric" />
          </label>
        </div>
        <div v-if="coordsError" class="hint err">{{ coordsError }}</div>
        <div v-else class="hint">Leave coordinates blank to let the server choose a spot on the map.</div>
      </template>

      <template v-else-if="action === 'mute'">
        <div class="field">
          <span class="field-label">Duration</span>
          <DurationPicker v-model="form.duration" v-model:valid="form.durationValid" permanent-label="Indefinite" />
        </div>
        <label class="field">
          <span>Reason (optional)</span>
          <input v-model="form.reason" maxlength="200" />
        </label>
      </template>

      <div v-if="error" class="hint err" role="alert">{{ error }}</div>
      <div class="modal-actions">
        <button type="button" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn-accent" :disabled="!canSubmit">
          <span v-if="busy" class="spinner sm"></span>
          {{ action === 'message' ? 'Send' : action === 'warp' ? 'Warp' : 'Mute' }}
        </button>
      </div>
    </form>
  </Modal>
</template>
