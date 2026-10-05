<script setup>
import { RouterLink } from 'vue-router';
</script>

<template>
  <div class="panel onboarding">
    <h1>Connect to your teaoh server</h1>
    <p class="dim">
      This panel manages the server through its admin API. It sends no requests until an admin key is
      configured, so a missing key never counts toward the server's lockout for failed authentication.
    </p>
    <ol>
      <li>
        Find the key under <span class="mono">[admin] key</span> in <span class="mono">config/teaoh.toml</span>
        (or the <span class="mono">TEAOH_ADMIN_KEY</span> environment variable).
      </li>
      <li>Open Settings, paste the key, enter your operator name for the audit log, and save.</li>
    </ol>
    <div class="form-actions">
      <RouterLink class="btn btn-accent" to="/settings">Open Settings</RouterLink>
    </div>
    <p class="hint" style="margin: 1rem 0 0">
      Running a server with no key on loopback? Leave the key blank in Settings and click
      <strong>Test connection</strong>. Once that succeeds, the panel remembers that this server needs no key.
    </p>
  </div>
</template>

<style scoped>
.onboarding {
  max-width: 620px;
  margin: 3rem auto;
  padding: 1.75rem 2rem;
}
.onboarding ol {
  padding-left: 1.2rem;
  margin: 0 0 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
