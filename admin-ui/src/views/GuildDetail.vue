<script setup>
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api, usePolling } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAction } from '../composables/useAction.js';
import { usePageTitle } from '../composables/usePageTitle.js';
import { formatDateTime, formatFull, formatNumber } from '../util.js';

const route = useRoute();
const router = useRouter();
const tag = computed(() => String(route.params.tag || ''));
const poll = usePolling((t) => api.guild(t), { params: tag, interval: 15000, resetOnChange: true });
const guild = poll.data;
const notFound = computed(() => !guild.value && poll.error.value && poll.error.value.status === 404);

usePageTitle(() => (guild.value ? `${guild.value.tag} · Guild` : ''));

const members = computed(() => {
  const list = guild.value && Array.isArray(guild.value.members) ? [...guild.value.members] : [];
  return list.sort((a, b) => a.rank - b.rank || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
});
const onlineCount = computed(() => members.value.filter((m) => m.online).length);
const ranks = computed(() => (guild.value && Array.isArray(guild.value.ranks) ? guild.value.ranks : []));

const { isBusy, run } = useAction();

async function disband() {
  const g = guild.value;
  const result = await run(() => api.disbandGuild(g.tag), {
    key: 'disband',
    confirm: {
      title: 'Disband guild',
      message: `Disband ${g.name} [${g.tag}]? All ${members.value.length} members will be removed and the guild bank (${formatNumber(g.bank)} gold) is lost. This cannot be undone.`,
      confirmLabel: 'Disband guild',
      danger: true,
      requireText: g.tag,
    },
    success: `Guild ${g.tag} disbanded`,
    failure: 'Disband failed',
  });
  if (result) router.push({ name: 'guilds' });
}
</script>

<template>
  <div>
    <RouterLink class="back-link" :to="{ name: 'guilds' }">← Guilds</RouterLink>

    <div v-if="notFound" class="panel state">
      <strong>Guild “{{ tag }}” was not found.</strong>
      <RouterLink :to="{ name: 'guilds' }">Back to guilds</RouterLink>
    </div>

    <AsyncState v-else :ready="Boolean(guild)" :error="poll.error.value" @retry="poll.refresh">
      <template v-if="guild">
        <div class="page-header">
          <div>
            <div class="page-title">
              <h1>{{ guild.name }}</h1>
              <span class="badge tone-blue mono">{{ guild.tag }}</span>
            </div>
            <div class="subtitle">
              {{ members.length }} member{{ members.length === 1 ? '' : 's' }} · {{ onlineCount }} online ·
              created <span :title="formatFull(guild.createdAt)">{{ formatDateTime(guild.createdAt) }}</span>
            </div>
          </div>
          <div class="row">
            <button type="button" class="btn-sm" :disabled="poll.loading.value" @click="poll.refresh">Refresh</button>
            <button type="button" class="btn-danger" :disabled="isBusy('disband')" @click="disband">Disband…</button>
          </div>
        </div>

        <div class="grid-2">
          <div class="stack">
            <section class="panel">
              <div class="panel-head"><h3>Description</h3></div>
              <p v-if="guild.description" class="pre-wrap" style="margin: 0">{{ guild.description }}</p>
              <p v-else class="dim" style="margin: 0">No description.</p>
            </section>
            <section class="panel">
              <div class="panel-head"><h3>Bank</h3></div>
              <div class="card" style="border: none; padding: 0">
                <div class="value mono">{{ formatNumber(guild.bank) }} <small>gold</small></div>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><h3>Ranks</h3></div>
              <table v-if="ranks.length" class="table-compact">
                <tbody>
                  <tr v-for="(name, i) in ranks" :key="i">
                    <td class="mono dim" style="width: 2rem">{{ i + 1 }}</td>
                    <td>{{ name || '—' }}</td>
                    <td class="num dim">{{ members.filter((m) => m.rank === i + 1).length }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="dim">No ranks defined.</div>
            </section>
          </div>

          <section class="panel">
            <div class="panel-head"><h3>Members <span class="dim">({{ members.length }})</span></h3></div>
            <div v-if="members.length" class="table-wrap plain" style="max-height: 70vh">
              <table class="table-compact">
                <thead>
                  <tr><th>Name</th><th>Rank</th><th class="num">Level</th><th>Status</th></tr>
                </thead>
                <tbody>
                  <tr v-for="m in members" :key="m.characterId">
                    <td><RouterLink :to="{ name: 'character', params: { id: m.characterId } }">{{ m.name }}</RouterLink></td>
                    <td>{{ m.rankName || '—' }} <span class="dim small">({{ m.rank }})</span></td>
                    <td class="num">{{ m.level }}</td>
                    <td><StatusBadge :status="m.online ? 'online' : 'offline'" /></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="state">No members.</div>
          </section>
        </div>
      </template>
    </AsyncState>
  </div>
</template>
