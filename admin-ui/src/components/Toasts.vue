<script setup>
import { dismiss, toasts } from '../stores/toasts.js';

const ICONS = { success: '✓', error: '!', info: 'i' };
</script>

<template>
  <div class="toasts" role="region" aria-live="polite" aria-label="Notifications">
    <TransitionGroup name="toast">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="toast"
        :class="`toast-${t.type}`"
        :role="t.type === 'error' ? 'alert' : 'status'"
      >
        <span class="toast-icon" aria-hidden="true">{{ ICONS[t.type] }}</span>
        <span class="toast-text">{{ t.text }}</span>
        <button type="button" class="icon-btn" aria-label="Dismiss" @click="dismiss(t.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>
