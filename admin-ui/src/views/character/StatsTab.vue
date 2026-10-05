<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api } from '../../api.js';
import { useAction } from '../../composables/useAction.js';
import { useClasses } from '../../stores/lookups.js';
import { toast } from '../../stores/toasts.js';
import { ADMIN_LEVELS, GENDERS, adminLabel, toInt } from '../../util.js';

const props = defineProps({ character: { type: Object, required: true } });
const emit = defineEmits(['updated', 'refresh', 'deleted']);

const BASE_STATS = ['str', 'int', 'wis', 'agi', 'con', 'cha'];

const GROUPS = [
  {
    title: 'Progress',
    fields: [
      { key: 'level', label: 'Level', min: 0 },
      { key: 'experience', label: 'Experience', min: 0 },
      { key: 'statPoints', label: 'Stat points', min: 0 },
      { key: 'skillPoints', label: 'Skill points', min: 0 },
      { key: 'karma', label: 'Karma', min: 0 },
      { key: 'hp', label: 'HP', min: 0 },
      { key: 'tp', label: 'TP', min: 0 },
    ],
  },
  {
    title: 'Base stats',
    fields: BASE_STATS.map((key) => ({ key, label: key.toUpperCase(), min: 0 })),
  },
  {
    title: 'Identity',
    fields: [
      { key: 'classId', label: 'Class', kind: 'class' },
      { key: 'adminLevel', label: 'Admin level', kind: 'admin' },
      { key: 'title', label: 'Title', kind: 'text', maxlength: 32 },
      { key: 'home', label: 'Home', kind: 'text', maxlength: 32 },
    ],
  },
  {
    title: 'Appearance',
    fields: [
      { key: 'gender', label: 'Gender', kind: 'gender' },
      { key: 'hairStyle', label: 'Hair style', min: 0 },
      { key: 'hairColor', label: 'Hair colour', min: 0 },
      { key: 'skin', label: 'Skin', min: 0 },
    ],
  },
];

const FIELDS = GROUPS.flatMap((g) => g.fields);
const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

const { classes } = useClasses();
const { isBusy, run } = useAction();

const draft = reactive({});
const baseline = ref({});
const conflicts = ref([]);

function valueFrom(c, key) {
  if (BASE_STATS.includes(key)) return c.baseStats ? c.baseStats[key] : undefined;
  return c[key];
}

function snapshot(c) {
  const out = {};
  for (const f of FIELDS) {
    const v = valueFrom(c, f.key);
    out[f.key] = f.kind === 'text' ? (v ?? '') : v;
  }
  return out;
}

function normalize(field, value) {
  if (field.kind === 'text') return String(value ?? '');
  return toInt(value);
}

function differs(key) {
  const f = FIELD_BY_KEY[key];
  return normalize(f, draft[key]) !== normalize(f, baseline.value[key]);
}

const dirtyKeys = computed(() => FIELDS.filter((f) => differs(f.key)).map((f) => f.key));
const dirty = computed(() => dirtyKeys.value.length > 0);

function resetFrom(c) {
  const snap = snapshot(c);
  baseline.value = snap;
  Object.assign(draft, snap);
  conflicts.value = [];
}

watch(
  () => props.character,
  (c, prev) => {
    if (!c) return;
    if (!prev || prev.id !== c.id || !dirty.value) {
      resetFrom(c);
      return;
    }
    const snap = snapshot(c);
    const edited = new Set(dirtyKeys.value);
    const nextBaseline = { ...baseline.value };
    const found = new Set(conflicts.value);
    for (const f of FIELDS) {
      if (normalize(f, snap[f.key]) === normalize(f, baseline.value[f.key])) continue;
      if (edited.has(f.key)) {
        found.add(f.key);
      } else {
        nextBaseline[f.key] = snap[f.key];
        draft[f.key] = snap[f.key];
      }
    }
    baseline.value = nextBaseline;
    conflicts.value = [...found];
  },
  { immediate: true },
);

const errors = computed(() => {
  const out = {};
  for (const key of dirtyKeys.value) {
    const f = FIELD_BY_KEY[key];
    if (f.kind === 'text') continue;
    const n = toInt(draft[key]);
    if (n === null) out[key] = 'Whole number required';
    else if (f.min !== undefined && n < f.min) out[key] = `Must be ≥ ${f.min}`;
  }
  return out;
});
const hasErrors = computed(() => Object.keys(errors.value).length > 0);

async function save() {
  if (!dirty.value || hasErrors.value) return;
  const changes = {};
  for (const key of dirtyKeys.value) changes[key] = normalize(FIELD_BY_KEY[key], draft[key]);
  const adminChange = 'adminLevel' in changes;
  const result = await run(() => api.updateCharacter(props.character.id, changes), {
    key: 'save',
    confirm: adminChange
      ? {
          title: 'Change admin level',
          message: `Change ${props.character.name}'s admin level from ${adminLabel(baseline.value.adminLevel)} to ${adminLabel(changes.adminLevel)}?`,
          confirmLabel: 'Change admin level',
          danger: changes.adminLevel > baseline.value.adminLevel,
        }
      : null,
    success: `Saved ${Object.keys(changes).length} field${Object.keys(changes).length === 1 ? '' : 's'} for ${props.character.name}`,
    failure: 'Save failed',
  });
  if (!result) return;
  if (result && typeof result === 'object' && 'baseStats' in result) {
    const adjusted = Object.keys(changes).filter(
      (key) => normalize(FIELD_BY_KEY[key], valueFrom(result, key)) !== changes[key],
    );
    resetFrom(result);
    emit('updated', result);
    if (adjusted.length) {
      toast.info(`The server adjusted: ${adjusted.map((k) => FIELD_BY_KEY[k].label).join(', ')} (values are clamped like $set).`);
    }
  } else {
    emit('refresh');
  }
}

function discard() {
  resetFrom(props.character);
}

function reloadFromServer() {
  resetFrom(props.character);
}
</script>

<template>
  <form class="stack" @submit.prevent="save">
    <div v-if="conflicts.length" class="banner banner-warn">
      <span class="banner-text">
        Changed on the server while you were editing:
        {{ conflicts.map((k) => FIELD_BY_KEY[k].label).join(', ') }}. Saving will overwrite those values.
      </span>
      <button type="button" class="btn-sm" @click="reloadFromServer">Discard my edits and load current values</button>
    </div>

    <div class="grid-2">
      <section v-for="group in GROUPS" :key="group.title" class="panel">
        <div class="panel-head"><h3>{{ group.title }}</h3></div>
        <div class="form-grid">
          <label
            v-for="f in group.fields"
            :key="f.key"
            class="field"
            :class="{ changed: differs(f.key) }"
          >
            <span>
              {{ f.label }}
              <span v-if="differs(f.key)" class="warn-text small" :title="`was ${baseline[f.key]}`">· was {{ f.kind === 'text' ? `“${baseline[f.key]}”` : baseline[f.key] }}</span>
            </span>
            <select v-if="f.kind === 'class' && classes && classes.length" v-model.number="draft[f.key]">
              <option v-if="!classes.some((cl) => cl.id === draft[f.key])" :value="draft[f.key]">#{{ draft[f.key] }}</option>
              <option v-for="cl in classes" :key="cl.id" :value="cl.id">{{ cl.name }} (#{{ cl.id }})</option>
            </select>
            <select v-else-if="f.kind === 'admin'" v-model.number="draft[f.key]">
              <option v-for="(label, level) in ADMIN_LEVELS" :key="level" :value="level">{{ level }} · {{ label }}</option>
            </select>
            <select v-else-if="f.kind === 'gender'" v-model.number="draft[f.key]">
              <option v-for="(label, g) in GENDERS" :key="g" :value="g">{{ label }}</option>
            </select>
            <input v-else-if="f.kind === 'text'" v-model="draft[f.key]" :maxlength="f.maxlength" />
            <input
              v-else
              v-model="draft[f.key]"
              type="number"
              step="1"
              :min="f.min"
              inputmode="numeric"
              :class="{ invalid: errors[f.key] }"
            />
            <span v-if="errors[f.key]" class="hint err">{{ errors[f.key] }}</span>
          </label>
        </div>
      </section>
    </div>

    <div class="panel row between" style="position: sticky; bottom: 0; z-index: 2">
      <span class="dim small">
        <template v-if="dirty">{{ dirtyKeys.length }} changed field{{ dirtyKeys.length === 1 ? '' : 's' }} will be sent; values are validated and clamped like the in-game $set command.</template>
        <template v-else>No changes.</template>
        {{ character.online ? ' Online characters are updated live.' : '' }}
      </span>
      <div class="row">
        <button type="button" :disabled="!dirty || isBusy('save')" @click="discard">Discard</button>
        <button type="submit" class="btn-accent" :disabled="!dirty || hasErrors || isBusy('save')">
          <span v-if="isBusy('save')" class="spinner sm"></span> Save changes
        </button>
      </div>
    </div>
  </form>
</template>
