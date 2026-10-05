<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import StatusBadge from '../../components/StatusBadge.vue';
import TimeAgo from '../../components/TimeAgo.vue';
import { GENDERS, adminLabel, formatNumber, formatSpan, percent } from '../../util.js';

const props = defineProps({ character: { type: Object, required: true } });
defineEmits(['updated', 'refresh', 'deleted']);

const DIRECTIONS = ['Down', 'Left', 'Up', 'Right'];
const STAT_LABELS = { str: 'STR', int: 'INT', wis: 'WIS', agi: 'AGI', con: 'CON', cha: 'CHA' };

const c = computed(() => props.character);
const mod = computed(() => c.value.moderation || {});
const location = computed(() => c.value.location || {});
</script>

<template>
  <div class="grid-2">
    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h3>Identity</h3></div>
        <dl class="kv">
          <dt>Character id</dt>
          <dd class="mono">{{ c.id }}</dd>
          <dt>Account</dt>
          <dd>
            <RouterLink :to="{ name: 'account', params: { id: c.accountId } }">{{ c.accountName }}</RouterLink>
            <span class="mono dim ml">#{{ c.accountId }}</span>
          </dd>
          <dt>Admin level</dt>
          <dd>
            {{ adminLabel(c.adminLevel) }} <span class="dim">({{ c.adminLevel }})</span>
            <StatusBadge v-if="c.adminLevel > 0" status="staff" tone="yellow" label="staff" style="margin-left: 0.35rem" />
          </dd>
          <dt>Title</dt>
          <dd>{{ c.title || '—' }}</dd>
          <dt>Home</dt>
          <dd>{{ c.home || '—' }}</dd>
          <dt>Partner</dt>
          <dd>{{ c.partner || '—' }}</dd>
          <dt>Fiancé(e)</dt>
          <dd>{{ c.fiance || '—' }}</dd>
          <dt>Gender</dt>
          <dd>{{ GENDERS[c.gender] ?? c.gender }}</dd>
          <dt>Appearance</dt>
          <dd>hair style {{ c.hairStyle }} · hair colour {{ c.hairColor }} · skin {{ c.skin }}</dd>
          <dt>Play time</dt>
          <dd>{{ Number.isFinite(c.usage) ? formatSpan(c.usage * 60) : '—' }}</dd>
          <template v-if="c.online">
            <dt>IP address</dt>
            <dd class="mono">{{ c.ip || '—' }}</dd>
            <dt>Player id</dt>
            <dd class="mono">{{ c.playerId ?? '—' }}</dd>
          </template>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>Location</h3>
          <RouterLink :to="{ name: 'maps', query: { id: location.map } }">Open in map viewer →</RouterLink>
        </div>
        <dl class="kv">
          <dt>Map</dt>
          <dd>{{ location.mapName || 'unnamed' }} <span class="mono dim">#{{ location.map }}</span></dd>
          <dt>Coordinates</dt>
          <dd class="mono">{{ location.x }}, {{ location.y }}</dd>
          <dt>Facing</dt>
          <dd>{{ DIRECTIONS[location.direction] ?? location.direction }}</dd>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Guild</h3></div>
        <dl v-if="c.guild" class="kv">
          <dt>Guild</dt>
          <dd>
            <RouterLink :to="{ name: 'guild', params: { tag: c.guild.tag } }">{{ c.guild.name }}</RouterLink>
            <span class="mono dim ml">[{{ c.guild.tag }}]</span>
          </dd>
          <dt>Rank</dt>
          <dd>{{ c.guild.rankName || '—' }} <span class="dim">({{ c.guild.rank }})</span></dd>
        </dl>
        <div v-else class="dim">Not in a guild.</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Moderation</h3></div>
        <div class="chips" style="margin-bottom: 0.6rem">
          <StatusBadge :status="mod.banned ? 'banned' : 'not banned'" :tone="mod.banned ? 'red' : 'dim'" />
          <StatusBadge :status="mod.muted ? 'muted' : 'not muted'" :tone="mod.muted ? 'yellow' : 'dim'" />
          <StatusBadge :status="mod.frozen ? 'frozen' : 'not frozen'" :tone="mod.frozen ? 'cyan' : 'dim'" />
          <StatusBadge :status="mod.jailed ? 'jailed' : 'not jailed'" :tone="mod.jailed ? 'orange' : 'dim'" />
        </div>
        <dl class="kv">
          <template v-if="mod.muted">
            <dt>Muted until</dt>
            <dd><TimeAgo :value="mod.mutedUntil" empty="indefinitely" /></dd>
          </template>
          <template v-if="mod.banned">
            <dt>Active ban</dt>
            <dd>
              <RouterLink :to="{ name: 'bans' }">#{{ mod.activeBanId ?? '?' }}</RouterLink>
            </dd>
          </template>
        </dl>
        <RouterLink :to="{ query: { tab: 'moderation' } }" class="small">Moderation actions →</RouterLink>
      </section>
    </div>

    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h3>Progress</h3></div>
        <dl class="kv">
          <dt>Class</dt>
          <dd>{{ c.className }} <span class="mono dim">#{{ c.classId }}</span></dd>
          <dt>Level</dt>
          <dd>{{ c.level }}</dd>
          <dt>Experience</dt>
          <dd class="mono">{{ formatNumber(c.experience) }}</dd>
          <dt>HP</dt>
          <dd>
            <div class="row nowrap">
              <div class="meter grow"><span :style="{ width: `${percent(c.hp, c.maxHp)}%` }"></span></div>
              <span class="mono small">{{ c.hp }} / {{ c.maxHp }}</span>
            </div>
          </dd>
          <dt>TP</dt>
          <dd>
            <div class="row nowrap">
              <div class="meter tp grow"><span :style="{ width: `${percent(c.tp, c.maxTp)}%` }"></span></div>
              <span class="mono small">{{ c.tp }} / {{ c.maxTp }}</span>
            </div>
          </dd>
          <dt>Stat / skill points</dt>
          <dd>{{ c.statPoints }} / {{ c.skillPoints }}</dd>
          <dt>Karma</dt>
          <dd>{{ c.karma }}</dd>
          <dt>Gold</dt>
          <dd class="mono">{{ formatNumber(c.gold) }}</dd>
          <dt>Bank</dt>
          <dd><span class="mono">{{ formatNumber(c.bankGold) }}</span> gold · vault level {{ c.bankLevel }}</dd>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Stats</h3></div>
        <div class="cards" style="grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 0.6rem">
          <div v-for="(v, k) in c.baseStats || {}" :key="k" class="card" style="padding: 0.5rem 0.7rem">
            <div class="label">{{ STAT_LABELS[k] || k }}</div>
            <div class="value" style="font-size: 1.2rem">{{ v }}</div>
          </div>
        </div>
        <template v-if="c.secondaryStats">
          <div class="row mono dim small" style="margin-top: 0.8rem; gap: 1rem">
            <span>damage {{ c.secondaryStats.minDamage }}–{{ c.secondaryStats.maxDamage }}</span>
            <span>accuracy {{ c.secondaryStats.accuracy }}</span>
            <span>evade {{ c.secondaryStats.evade }}</span>
            <span>armor {{ c.secondaryStats.armor }}</span>
          </div>
        </template>
        <div v-else class="hint" style="margin-top: 0.8rem">Combat stats are only computed while the character is online.</div>
      </section>

      <section class="panel">
        <div class="panel-head"><h3>Equipment</h3></div>
        <table v-if="(c.equipment || []).length" class="table-compact">
          <tbody>
            <tr v-for="e in c.equipment" :key="e.slot">
              <td class="dim">{{ e.slot }}</td>
              <td>{{ e.name }} <span class="mono dim">#{{ e.id }}</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="dim">Nothing equipped.</div>
      </section>
    </div>
  </div>
</template>
