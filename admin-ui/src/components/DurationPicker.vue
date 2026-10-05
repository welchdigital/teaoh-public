<script setup>
import { computed, ref, watch } from 'vue';
import { MAX_DURATION_MINUTES } from '../api.js';
import { formatMinutes } from '../util.js';

const model = defineModel({ default: 60 });
const valid = defineModel('valid', { default: true });
const props = defineProps({
  allowPermanent: { type: Boolean, default: true },
  permanentLabel: { type: String, default: 'Permanent' },
  disabled: { type: Boolean, default: false },
});

const PRESETS = [
  { label: '15m', minutes: 15 },
  { label: '1h', minutes: 60 },
  { label: '1d', minutes: 1440 },
  { label: '7d', minutes: 10080 },
  { label: '30d', minutes: 43200 },
];
const UNITS = [
  { label: 'minutes', minutes: 1 },
  { label: 'hours', minutes: 60 },
  { label: 'days', minutes: 1440 },
  { label: 'weeks', minutes: 10080 },
];
const MAX_MINUTES = MAX_DURATION_MINUTES;

const custom = ref(false);
const amount = ref('');
const unit = ref(60);

function isValidMinutes(v) {
  return Number.isInteger(v) && v > 0 && v <= MAX_MINUTES;
}

function bestUnit(minutes) {
  for (let i = UNITS.length - 1; i >= 0; i -= 1) {
    if (minutes % UNITS[i].minutes === 0) return UNITS[i];
  }
  return UNITS[0];
}

function fillCustom(minutes) {
  const u = bestUnit(minutes);
  unit.value = u.minutes;
  amount.value = String(minutes / u.minutes);
}

const customRaw = computed(() => {
  const raw = String(amount.value ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * unit.value);
});

const tooLong = computed(() => customRaw.value !== null && customRaw.value > MAX_MINUTES);

const customMinutes = computed(() => (isValidMinutes(customRaw.value) ? customRaw.value : null));

const unitMax = computed(() => Math.floor(MAX_MINUTES / unit.value));

function sync(value) {
  if (value === null && props.allowPermanent) {
    custom.value = false;
    valid.value = true;
    return;
  }
  if (!isValidMinutes(value)) {
    model.value = 60;
    return;
  }
  if (custom.value && value === customMinutes.value) return;
  if (PRESETS.some((p) => p.minutes === value)) {
    custom.value = false;
  } else {
    custom.value = true;
    fillCustom(value);
  }
  valid.value = true;
}

watch(model, sync, { immediate: true });

function choosePreset(minutes) {
  custom.value = false;
  valid.value = true;
  model.value = minutes;
}

function chooseCustom() {
  if (custom.value) return;
  custom.value = true;
  if (isValidMinutes(model.value)) fillCustom(model.value);
  else {
    unit.value = 60;
    amount.value = '1';
  }
  applyCustom();
}

function applyCustom() {
  if (!custom.value) return;
  const minutes = customMinutes.value;
  if (minutes === null) {
    valid.value = false;
    return;
  }
  valid.value = true;
  if (model.value !== minutes) model.value = minutes;
}

watch([amount, unit], applyCustom);

const summary = computed(() => {
  if (custom.value && tooLong.value) {
    return `Too long: the maximum is 10 years.${props.allowPermanent ? ` Choose ${props.permanentLabel} instead.` : ''}`;
  }
  if (custom.value && customMinutes.value === null) return 'Enter a positive duration (at least one minute).';
  if (model.value === null) return props.permanentLabel;
  const minutes = model.value;
  return `${minutes.toLocaleString()} minute${minutes === 1 ? '' : 's'} (${formatMinutes(minutes)})`;
});
</script>

<template>
  <div class="duration-picker">
    <div class="chips" role="group" aria-label="Duration presets">
      <button
        v-for="p in PRESETS"
        :key="p.minutes"
        type="button"
        class="chip"
        :class="{ on: !custom && model === p.minutes }"
        :aria-pressed="!custom && model === p.minutes"
        :disabled="disabled"
        @click="choosePreset(p.minutes)"
      >
        {{ p.label }}
      </button>
      <button
        v-if="allowPermanent"
        type="button"
        class="chip"
        :class="{ on: !custom && model === null }"
        :aria-pressed="!custom && model === null"
        :disabled="disabled"
        @click="choosePreset(null)"
      >
        {{ permanentLabel }}
      </button>
      <button
        type="button"
        class="chip"
        :class="{ on: custom }"
        :aria-pressed="custom"
        :disabled="disabled"
        @click="chooseCustom"
      >
        Custom
      </button>
    </div>
    <div v-if="custom" class="row" style="margin-top: 0.5rem">
      <input
        v-model="amount"
        type="number"
        min="0"
        :max="unitMax"
        step="any"
        inputmode="decimal"
        aria-label="Duration amount"
        :class="{ invalid: !valid }"
        :disabled="disabled"
      />
      <select v-model.number="unit" aria-label="Duration unit" :disabled="disabled">
        <option v-for="u in UNITS" :key="u.minutes" :value="u.minutes">{{ u.label }}</option>
      </select>
    </div>
    <div class="hint" :class="{ err: !valid }" style="margin-top: 0.35rem">{{ summary }}</div>
  </div>
</template>
