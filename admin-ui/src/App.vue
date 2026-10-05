<script setup>
import { computed, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { configured, connection, settings } from './api.js';
import { useNow } from './composables/now.js';
import { useStatus } from './stores/status.js';
import { formatCountdown } from './util.js';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ConnectionBanner from './components/ConnectionBanner.vue';
import Onboarding from './components/Onboarding.vue';
import ShutdownBanner from './components/ShutdownBanner.vue';
import Toasts from './components/Toasts.vue';

const route = useRoute();
const { status } = useStatus();
const now = useNow(1000);
const showOnboarding = computed(() => !configured.value && route.name !== 'settings');
const navOpen = ref(false);

watch(
  () => route.fullPath,
  () => {
    navOpen.value = false;
  },
);

const NAV = [
  {
    label: 'Overview',
    items: [
      { to: '/', section: 'dashboard', icon: '◈', label: 'Dashboard' },
      { to: '/server', section: 'server', icon: '⚑', label: 'Server' },
    ],
  },
  {
    label: 'Players',
    items: [
      { to: '/players', section: 'players', icon: '☻', label: 'Online players' },
      { to: '/characters', section: 'characters', icon: '♞', label: 'Characters' },
      { to: '/accounts', section: 'accounts', icon: '▣', label: 'Accounts' },
    ],
  },
  {
    label: 'Moderation',
    items: [
      { to: '/bans', section: 'bans', icon: '⊘', label: 'Bans' },
      { to: '/mutes', section: 'mutes', icon: '⊖', label: 'Mutes' },
      { to: '/reports', section: 'reports', icon: '⚐', label: 'Reports' },
    ],
  },
  {
    label: 'World',
    items: [
      { to: '/guilds', section: 'guilds', icon: '♜', label: 'Guilds' },
      { to: '/maps', section: 'maps', icon: '▦', label: 'Map viewer' },
    ],
  },
  {
    label: 'Records',
    items: [
      { to: '/logs', section: 'logs', icon: '▤', label: 'Logs' },
      { to: '/chat', section: 'chat', icon: '✎', label: 'Chat' },
      { to: '/audit', section: 'audit', icon: '☰', label: 'Audit log' },
    ],
  },
];

const section = computed(() => route.meta.section || route.name);

const pill = computed(() => {
  const state = connection.state;
  if (!configured.value) return { tone: 'warn', text: 'not configured' };
  if (state === 'unauthorized') return { tone: 'bad', text: 'unauthorized' };
  if (state === 'rate-limited') {
    const left = connection.retryAt ? Math.max(0, (connection.retryAt - now.value) / 1000) : 0;
    return { tone: 'bad', text: left > 0 ? `locked out · ${formatCountdown(left)}` : 'locked out' };
  }
  if (state === 'offline') return { tone: 'bad', text: 'disconnected' };
  if (status.value) {
    const s = status.value;
    return { tone: s.shutdown ? 'warn' : 'ok', text: `${s.online} / ${s.maxPlayers} online` };
  }
  return { tone: '', text: 'connecting…' };
});
</script>

<template>
  <div class="app">
    <header class="topbar">
      <button type="button" class="icon-btn" aria-label="Open navigation" :aria-expanded="navOpen" @click="navOpen = !navOpen">☰</button>
      <div class="brand">tea<span>oh</span> · admin</div>
      <div class="status"><span class="dot" :class="pill.tone"></span>{{ pill.text }}</div>
    </header>

    <div v-if="navOpen" class="scrim" @click="navOpen = false"></div>

    <nav class="sidebar" :class="{ open: navOpen }" aria-label="Main navigation">
      <div class="brand">tea<span>oh</span> · admin</div>
      <template v-for="group in NAV" :key="group.label">
        <div class="nav-group">{{ group.label }}</div>
        <RouterLink
          v-for="item in group.items"
          :key="item.to"
          class="nav-link"
          :class="{ active: section === item.section }"
          :aria-current="section === item.section ? 'page' : undefined"
          :to="item.to"
        >
          <span class="icon" aria-hidden="true">{{ item.icon }}</span>{{ item.label }}
        </RouterLink>
      </template>
      <div class="nav-group"></div>
      <RouterLink
        class="nav-link"
        :class="{ active: section === 'settings' }"
        :aria-current="section === 'settings' ? 'page' : undefined"
        to="/settings"
      >
        <span class="icon" aria-hidden="true">⚙</span>Settings
      </RouterLink>

      <div class="status-pill">
        <div class="row nowrap"><span class="dot" :class="pill.tone"></span>{{ pill.text }}</div>
        <div class="mono">{{ settings.baseUrl || 'same origin' }}</div>
        <div v-if="settings.actor">as <strong>{{ settings.actor }}</strong></div>
        <RouterLink v-else to="/settings" class="small">Set operator name</RouterLink>
      </div>
    </nav>

    <main class="main">
      <div class="main-inner">
        <template v-if="configured">
          <ConnectionBanner />
          <ShutdownBanner />
        </template>
        <Onboarding v-if="showOnboarding" />
        <RouterView v-else />
      </div>
    </main>

    <Toasts />
    <ConfirmDialog />
  </div>
</template>
