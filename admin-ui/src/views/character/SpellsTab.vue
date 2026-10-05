<script setup>
import { computed } from 'vue';

const props = defineProps({ character: { type: Object, required: true } });
defineEmits(['updated', 'refresh', 'deleted']);

const spells = computed(() => props.character.spells || []);
</script>

<template>
  <section class="panel">
    <div class="panel-head"><h3>Spells <span class="dim">({{ spells.length }})</span></h3></div>
    <div v-if="spells.length" class="table-wrap plain">
      <table>
        <thead>
          <tr><th>Spell</th><th>Id</th><th class="num">Level</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in spells" :key="s.id">
            <td>{{ s.name }}</td>
            <td class="mono dim">{{ s.id }}</td>
            <td class="num">{{ s.level }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else class="state">No spells learned.</div>
  </section>
</template>
