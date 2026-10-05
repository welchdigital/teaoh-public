<script setup>
import { computed, ref } from 'vue';
import StatusBadge from '../../components/StatusBadge.vue';

const props = defineProps({ character: { type: Object, required: true } });
defineEmits(['updated', 'refresh', 'deleted']);

const filter = ref('all');
const quests = computed(() => props.character.quests || []);
const shown = computed(() => {
  if (filter.value === 'active') return quests.value.filter((q) => !q.completed);
  if (filter.value === 'completed') return quests.value.filter((q) => q.completed);
  return quests.value;
});
</script>

<template>
  <section class="panel">
    <div class="panel-head">
      <h3>Quests <span class="dim">({{ quests.length }})</span></h3>
      <div class="segmented" role="radiogroup" aria-label="Quest filter">
        <button
          v-for="f in ['all', 'active', 'completed']"
          :key="f"
          type="button"
          role="radio"
          :aria-checked="filter === f"
          :class="{ on: filter === f }"
          @click="filter = f"
        >
          {{ f }}
        </button>
      </div>
    </div>
    <div v-if="shown.length" class="table-wrap plain">
      <table>
        <thead>
          <tr><th>Quest</th><th>Id</th><th>State</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr v-for="q in shown" :key="q.id">
            <td>{{ q.name }}</td>
            <td class="mono dim">{{ q.id }}</td>
            <td class="mono">{{ q.state }}</td>
            <td><StatusBadge :status="q.completed ? 'completed' : 'in progress'" /></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="state">{{ quests.length ? 'No quests match the filter.' : 'No quest progress recorded.' }}</div>
  </section>
</template>
