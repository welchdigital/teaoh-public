<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { usePageTitle } from '../composables/usePageTitle.js';
import { adminLabel, formatTime } from '../util.js';
import ItemsTab from './character/ItemsTab.vue';
import ModerationTab from './character/ModerationTab.vue';
import OverviewTab from './character/OverviewTab.vue';
import QuestsTab from './character/QuestsTab.vue';
import SpellsTab from './character/SpellsTab.vue';
import StatsTab from './character/StatsTab.vue';

const route = useRoute();
const router = useRouter();
const id = computed(() => Number(route.params.id));

const poll = usePolling((cid) => api.character(cid), {
  params: id,
  interval: 5000,
  resetOnChange: true,
  enabled: () => Number.isInteger(id.value) && id.value > 0,
});
const character = poll.data;

const notFound = computed(() => !character.value && poll.error.value && poll.error.value.status === 404);

usePageTitle(() => (character.value ? `${character.value.name} · Character` : ''));

const TABS = [
  { key: 'overview', label: 'Overview', component: OverviewTab },
  { key: 'stats', label: 'Stats', component: StatsTab },
  { key: 'items', label: 'Inventory & bank', component: ItemsTab, count: (c) => (c.inventory || []).length },
  { key: 'spells', label: 'Spells', component: SpellsTab, count: (c) => (c.spells || []).length },
  { key: 'quests', label: 'Quests', component: QuestsTab, count: (c) => (c.quests || []).length },
  { key: 'moderation', label: 'Moderation', component: ModerationTab },
];

const tab = computed({
  get: () => (TABS.some((t) => t.key === route.query.tab) ? route.query.tab : 'overview'),
  set: (value) => {
    router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } });
  },
});

const activeTab = computed(() => TABS.find((t) => t.key === tab.value) || TABS[0]);

function isCharacterDetail(value) {
  return value && typeof value === 'object' && 'baseStats' in value && 'location' in value;
}

function onUpdated(detail) {
  if (isCharacterDetail(detail)) poll.mutate(detail);
  else poll.refresh();
}

function onDeleted() {
  router.push({ name: 'characters' });
}

const mod = computed(() => (character.value && character.value.moderation) || {});
</script>

<template>
  <div>
    <RouterLink class="back-link" :to="{ name: 'characters' }">← Characters</RouterLink>

    <div v-if="notFound" class="panel state">
      <strong>Character #{{ route.params.id }} was not found.</strong>
      <RouterLink :to="{ name: 'characters' }">Back to character search</RouterLink>
    </div>

    <AsyncState v-else :ready="Boolean(character)" :error="poll.error.value" @retry="poll.refresh">
      <template v-if="character">
        <div class="page-header">
          <div>
            <div class="page-title">
              <h1>{{ character.name }}</h1>
              <StatusBadge :status="character.online ? 'online' : 'offline'" />
              <StatusBadge
                v-if="character.adminLevel > 0"
                status="staff"
                tone="yellow"
                :label="`⚠ Staff · ${adminLabel(character.adminLevel)}`"
                title="This character has admin powers. Double-check moderation actions."
              />
              <StatusBadge v-if="mod.banned" status="banned" />
              <StatusBadge v-if="mod.muted" status="muted" />
              <StatusBadge v-if="mod.frozen" status="frozen" />
              <StatusBadge v-if="mod.jailed" status="jailed" />
            </div>
            <div class="subtitle">
              #{{ character.id }} · level {{ character.level }} {{ character.className }} ·
              account
              <RouterLink :to="{ name: 'account', params: { id: character.accountId } }">{{ character.accountName }}</RouterLink>
              <template v-if="character.guild">
                · guild
                <RouterLink :to="{ name: 'guild', params: { tag: character.guild.tag } }">{{ character.guild.tag }}</RouterLink>
              </template>
            </div>
          </div>
          <div class="row">
            <span v-if="poll.updatedAt.value" class="hint">updated {{ formatTime(poll.updatedAt.value) }}</span>
            <button type="button" class="btn-sm" :disabled="poll.loading.value" @click="poll.refresh">Refresh</button>
          </div>
        </div>

        <div class="tabs" role="tablist" aria-label="Character sections">
          <button
            v-for="t in TABS"
            :key="t.key"
            type="button"
            role="tab"
            class="tab"
            :class="{ active: tab === t.key }"
            :aria-selected="tab === t.key"
            @click="tab = t.key"
          >
            {{ t.label }}
            <span v-if="t.count" class="count">{{ t.count(character) }}</span>
          </button>
        </div>

        <div role="tabpanel">
          <component
            :is="activeTab.component"
            :character="character"
            @updated="onUpdated"
            @refresh="poll.refresh"
            @deleted="onDeleted"
          />
        </div>
      </template>
    </AsyncState>
  </div>
</template>
