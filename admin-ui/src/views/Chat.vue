<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api, useTail } from '../api.js';
import StatusBadge from '../components/StatusBadge.vue';
import { formatFull, formatTime } from '../util.js';

const MAX_ROWS = 2000;
const CHANNELS = ['local', 'global', 'party', 'guild', 'pm', 'admin', 'announce', 'server'];
const CHANNEL_COLORS = {
  local: 'var(--text)',
  global: 'var(--accent)',
  party: 'var(--green)',
  guild: 'var(--purple)',
  pm: 'var(--yellow)',
  admin: 'var(--orange)',
  announce: 'var(--cyan)',
  server: 'var(--text-dim)',
};

const channel = ref('');
const search = ref('');
const paused = ref(false);

const tail = useTail((p) => api.chat(p), {
  params: computed(() => ({ channel: channel.value || undefined })),
  paused,
  interval: 2000,
  limit: 500,
  max: MAX_ROWS,
});

const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  const events = tail.events.value;
  if (!q) return events;
  return events.filter((e) =>
    [e.from, e.to, e.message].some((v) => v && String(v).toLowerCase().includes(q)),
  );
});

const scroller = ref(null);
const stick = ref(true);

function onScroll() {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

function jumpToLatest() {
  const el = scroller.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  stick.value = true;
}

watch(
  shown,
  async () => {
    if (!stick.value) return;
    await nextTick();
    jumpToLatest();
  },
  { flush: 'post' },
);

watch(channel, () => {
  stick.value = true;
});
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Chat</h1>
        <div class="subtitle">Live transcript across channels (last {{ MAX_ROWS.toLocaleString() }} messages).</div>
      </div>
      <div class="row">
        <StatusBadge :status="paused ? 'paused' : 'live'" :tone="paused ? 'yellow' : 'green'" />
        <button type="button" :class="paused ? 'btn-accent' : ''" @click="paused = !paused">{{ paused ? 'Resume' : 'Pause' }}</button>
        <button type="button" @click="tail.clear">Clear view</button>
      </div>
    </div>

    <div class="toolbar">
      <div class="chips" role="radiogroup" aria-label="Channel">
        <button
          type="button"
          class="chip"
          role="radio"
          :aria-checked="channel === ''"
          :class="{ on: channel === '' }"
          @click="channel = ''"
        >
          all
        </button>
        <button
          v-for="ch in CHANNELS"
          :key="ch"
          type="button"
          class="chip"
          role="radio"
          :aria-checked="channel === ch"
          :class="{ on: channel === ch }"
          @click="channel = ch"
        >
          <span class="dot" :style="{ background: CHANNEL_COLORS[ch], margin: 0 }"></span>
          {{ ch }}
        </button>
      </div>
      <input
        v-model="search"
        type="search"
        class="search-input right"
        placeholder="Filter by name or text…"
        aria-label="Filter chat"
      />
    </div>

    <div v-if="tail.error.value" class="inline-error" role="alert">
      {{ tail.error.value.message }}
      <button type="button" class="btn-sm btn-ghost" @click="tail.refresh">Retry</button>
    </div>

    <div class="panel chat-panel">
      <div ref="scroller" class="chat-scroll" role="log" aria-live="off" @scroll="onScroll">
        <div v-if="!tail.ready.value && !tail.error.value" class="state"><span class="spinner"></span> Loading…</div>
        <div v-else-if="tail.ready.value && shown.length === 0" class="state">
          {{ search ? 'No messages match the filter.' : 'No chat captured yet.' }}
        </div>
        <div v-for="m in shown" :key="m.seq" class="chat-line">
          <span class="mono dim small" :title="formatFull(m.time)">{{ formatTime(m.time) }}</span>
          <span class="badge" :style="{ color: CHANNEL_COLORS[m.channel] || 'var(--text-dim)', borderColor: 'var(--border)' }">{{ m.channel }}</span>
          <span class="chat-text">
            <strong>{{ m.from || 'server' }}</strong>
            <span v-if="m.to" class="ml">→ <strong>{{ m.to }}</strong></span>
            <RouterLink
              v-if="m.map !== null && m.map !== undefined && m.channel === 'local'"
              class="small ml"
              :to="{ name: 'maps', query: { id: m.map } }"
            >[map {{ m.map }}]</RouterLink><span>:</span>
            <span class="pre-wrap ml">{{ m.message }}</span>
          </span>
        </div>
      </div>
      <button v-if="!stick && shown.length" type="button" class="btn-sm btn-accent jump" @click="jumpToLatest">↓ Latest</button>
    </div>
  </div>
</template>

<style scoped>
.chat-panel {
  position: relative;
  padding: 0;
}
.chat-scroll {
  height: calc(100vh - 250px);
  min-height: 300px;
  overflow-y: auto;
  padding: 0.75rem 1rem;
}
.chat-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.18rem 0;
}
.chat-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.jump {
  position: absolute;
  right: 1rem;
  bottom: 1rem;
  box-shadow: var(--shadow);
}
</style>
