<script setup>
import { computed, reactive, ref } from 'vue';
import { api } from '../api.js';
import AsyncState from '../components/AsyncState.vue';
import MapSelect from '../components/MapSelect.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TimeAgo from '../components/TimeAgo.vue';
import { useAction } from '../composables/useAction.js';
import { useStatus } from '../stores/status.js';
import { formatCountdown, formatFull, formatSpan, formatTime, toInt } from '../util.js';

const { status, error: statusError, refresh: refreshStatus, shutdown, applySln, applyGlobalLock } = useStatus();
const { isBusy, run } = useAction();

const KINDS = [
  { value: 'announce', label: 'Announce', hint: 'Yellow announcement from “Server” to every player.' },
  { value: 'server', label: 'Server', hint: 'System message shown to every player.' },
  { value: 'admin', label: 'Admin', hint: 'Admin channel message, visible to Guardians and above only.' },
];

const announce = reactive({ kind: 'announce', message: '' });
const kindHint = computed(() => KINDS.find((k) => k.value === announce.kind)?.hint || '');

async function sendAnnouncement() {
  const message = announce.message.trim();
  if (!message) return;
  const ok = await run(() => api.announce(message, announce.kind), {
    key: 'announce',
    success: 'Announcement sent',
    failure: 'Announcement failed',
  });
  if (ok) announce.message = '';
}

async function toggleGlobal() {
  const locked = !(status.value && status.value.globalChatLocked);
  const result = await run(() => api.setGlobalLock(locked), {
    key: 'global',
    confirm: locked
      ? {
          title: 'Lock global chat',
          message: 'Players will not be able to talk on the global channel until it is unlocked.',
          confirmLabel: 'Lock global chat',
          danger: true,
        }
      : null,
    success: (r) => ((r && r.locked !== undefined ? r.locked : locked) ? 'Global chat locked' : 'Global chat unlocked'),
  });
  if (result) {
    applyGlobalLock(result && result.locked !== undefined ? Boolean(result.locked) : locked);
    refreshStatus();
  }
}

const quake = reactive({ magnitude: 4, mapId: null });

async function triggerQuake() {
  const magnitude = toInt(quake.magnitude);
  if (magnitude === null || magnitude < 1 || magnitude > 8) return;
  await run(() => api.quake(magnitude, quake.mapId === null ? null : toInt(quake.mapId)), {
    key: 'quake',
    success: `Magnitude ${magnitude} quake triggered ${quake.mapId === null ? 'on all maps' : `on map ${quake.mapId}`}`,
    failure: 'Quake failed',
  });
}

const saveResult = ref(null);

async function saveAll() {
  const result = await run(() => api.saveAll(), {
    key: 'save',
    success: (r) => `Saved ${r && r.saved !== undefined ? r.saved : 'all'} character${r && r.saved === 1 ? '' : 's'}`,
    failure: 'Save failed',
  });
  if (result) {
    saveResult.value = { saved: result.saved, at: Date.now() };
    refreshStatus();
  }
}

const SHUTDOWN_PRESETS = [30, 60, 300, 600, 1800];
const shutdownForm = reactive({ seconds: 300, message: '' });
const shutdownSeconds = computed(() => toInt(shutdownForm.seconds));
const shutdownValid = computed(
  () => shutdownSeconds.value !== null && shutdownSeconds.value >= 0 && shutdownSeconds.value <= 3600,
);

async function scheduleShutdown() {
  if (!shutdownValid.value) return;
  const seconds = shutdownSeconds.value;
  const immediate = seconds === 0;
  const result = await run(() => api.scheduleShutdown(seconds, shutdownForm.message), {
    key: 'shutdown',
    confirm: {
      title: immediate ? 'Shut down now' : 'Schedule shutdown',
      message: immediate
        ? 'Every character will be saved, all clients disconnected, and the server process will exit immediately.'
        : `The server will warn players, then save everyone and exit in ${formatSpan(seconds)}.`,
      confirmLabel: immediate ? 'Shut down now' : 'Schedule shutdown',
      danger: true,
      requireText: immediate ? 'shutdown' : '',
    },
    success: immediate ? 'Shutdown started' : `Shutdown scheduled in ${formatSpan(seconds)}`,
    failure: 'Shutdown failed',
  });
  if (result) refreshStatus();
}

async function cancelShutdown() {
  await run(() => api.cancelShutdown(), {
    key: 'cancel-shutdown',
    success: 'Scheduled shutdown cancelled',
    failure: 'Cancel failed',
  });
  refreshStatus();
}

const RELOAD_TARGETS = [
  { target: 'maps', label: 'Maps', hint: 'Re-read EMF map files' },
  { target: 'pubs', label: 'Pub files', hint: 'Items, NPCs, spells, classes' },
  { target: 'drops', label: 'Drops', hint: 'NPC drop tables' },
  { target: 'quests', label: 'Quests', hint: 'Quest scripts' },
  { target: 'formulas', label: 'Formulas', hint: 'Stat and damage formulas' },
  { target: 'news', label: 'News', hint: 'Login news board' },
  { target: 'shops', label: 'Shops', hint: 'Shop and craft data' },
  { target: 'config', label: 'Config', hint: 'Reloadable config values' },
];
const reloadResults = reactive({});

async function reload(target) {
  const result = await run(() => api.reload(target), {
    key: `reload-${target}`,
    success: (r) => `Reloaded ${target}${r && r.detail ? `: ${r.detail}` : ''}`,
    failure: `Reload ${target} failed`,
  });
  reloadResults[target] = result
    ? { ok: true, detail: result.detail || 'Reloaded.', at: Date.now() }
    : { ok: false, detail: 'Failed — see notification.', at: Date.now() };
}

const sln = computed(() => (status.value && status.value.sln) || null);

async function pingSln() {
  const result = await run(() => api.slnPing(), {
    key: 'sln',
    success: (r) => (r && r.sln && r.sln.lastError ? `SLN ping finished with an error: ${r.sln.lastError}` : 'SLN ping sent'),
    failure: 'SLN ping failed',
  });
  if (result && result.sln) applySln(result.sln);
}
</script>

<template>
  <div>
    <div class="page-header">
      <div>
        <h1>Server</h1>
        <div class="subtitle">Broadcasts, world events, persistence, reloads and lifecycle.</div>
      </div>
    </div>

    <AsyncState :ready="Boolean(status)" :error="statusError" @retry="refreshStatus">
      <div class="grid-2">
        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h3>Announcement</h3></div>
            <form class="form-stack" @submit.prevent="sendAnnouncement">
              <div class="segmented" role="radiogroup" aria-label="Announcement kind">
                <button
                  v-for="k in KINDS"
                  :key="k.value"
                  type="button"
                  role="radio"
                  :aria-checked="announce.kind === k.value"
                  :class="{ on: announce.kind === k.value }"
                  @click="announce.kind = k.value"
                >
                  {{ k.label }}
                </button>
              </div>
              <div class="hint">{{ kindHint }}</div>
              <label class="field">
                <span>Message</span>
                <input v-model="announce.message" maxlength="200" placeholder="The server will restart in 10 minutes…" />
                <span class="counter">{{ announce.message.length }} / 200</span>
              </label>
              <div class="form-actions">
                <button type="submit" class="btn-accent" :disabled="!announce.message.trim() || isBusy('announce')">
                  <span v-if="isBusy('announce')" class="spinner sm"></span> Send
                </button>
              </div>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>Global chat</h3>
              <StatusBadge
                :status="status.globalChatLocked ? 'locked' : 'open'"
                :tone="status.globalChatLocked ? 'red' : 'green'"
              />
            </div>
            <p class="dim">
              {{ status.globalChatLocked ? 'Global chat is locked; players cannot talk on ~global.' : 'Global chat is open to all players.' }}
            </p>
            <button
              type="button"
              :class="status.globalChatLocked ? 'btn-accent' : 'btn-warn'"
              :disabled="isBusy('global')"
              @click="toggleGlobal"
            >
              {{ status.globalChatLocked ? 'Unlock global chat' : 'Lock global chat' }}
            </button>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Earthquake</h3></div>
            <form class="form-stack" @submit.prevent="triggerQuake">
              <label class="field">
                <span>Magnitude: <strong>{{ quake.magnitude }}</strong></span>
                <input v-model.number="quake.magnitude" type="range" min="1" max="8" step="1" />
              </label>
              <label class="field">
                <span>Map</span>
                <MapSelect v-model="quake.mapId" allow-all />
              </label>
              <div class="form-actions">
                <button type="submit" class="btn-warn" :disabled="isBusy('quake')">Trigger quake</button>
              </div>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head">
              <h3>Server link (SLN)</h3>
              <StatusBadge v-if="sln" :status="sln.enabled ? 'enabled' : 'disabled'" />
            </div>
            <dl v-if="sln" class="kv">
              <dt>Last ping</dt>
              <dd><TimeAgo :value="sln.lastPingAt" empty="never" /></dd>
              <dt>Last result</dt>
              <dd class="pre-wrap">{{ sln.lastResult || '—' }}</dd>
              <dt>Last error</dt>
              <dd :class="{ err: sln.lastError }" class="pre-wrap">{{ sln.lastError || '—' }}</dd>
            </dl>
            <div class="form-actions" style="margin-top: 0.9rem">
              <button type="button" :disabled="isBusy('sln')" @click="pingSln">
                <span v-if="isBusy('sln')" class="spinner sm"></span> Ping now
              </button>
            </div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <div class="panel-head"><h3>Save</h3></div>
            <p class="dim">
              Saves every online character to the database and waits for completion.
              Last save: <TimeAgo :value="status.lastSaveAt" empty="never" />.
            </p>
            <div class="form-actions">
              <button type="button" class="btn-accent" :disabled="isBusy('save')" @click="saveAll">
                <span v-if="isBusy('save')" class="spinner sm"></span> Save all characters
              </button>
              <span v-if="saveResult" class="ok-text small">
                Saved {{ saveResult.saved ?? '?' }} at {{ formatTime(saveResult.at) }}
              </span>
            </div>
          </section>

          <section class="panel" :class="{ 'panel-danger': shutdown }">
            <div class="panel-head">
              <h3>Shutdown</h3>
              <StatusBadge v-if="shutdown" status="scheduled" tone="yellow" />
            </div>
            <div v-if="shutdown" class="banner banner-warn" style="margin-bottom: 0.9rem">
              <strong>In <span class="mono">{{ formatCountdown(shutdown.secondsRemaining) }}</span></strong>
              <span class="banner-text" :title="formatFull(shutdown.at)">{{ shutdown.message || 'No message.' }}</span>
              <button type="button" class="btn-sm btn-warn" :disabled="isBusy('cancel-shutdown')" @click="cancelShutdown">
                Cancel
              </button>
            </div>
            <form class="form-stack" @submit.prevent="scheduleShutdown">
              <div class="field">
                <span class="field-label">Countdown</span>
                <div class="chips">
                  <button
                    v-for="s in SHUTDOWN_PRESETS"
                    :key="s"
                    type="button"
                    class="chip"
                    :class="{ on: shutdownSeconds === s }"
                    @click="shutdownForm.seconds = s"
                  >
                    {{ formatSpan(s) }}
                  </button>
                  <button type="button" class="chip" :class="{ on: shutdownSeconds === 0 }" @click="shutdownForm.seconds = 0">
                    Now
                  </button>
                </div>
              </div>
              <label class="field">
                <span>Seconds (0–3600)</span>
                <input
                  v-model="shutdownForm.seconds"
                  type="number"
                  min="0"
                  max="3600"
                  step="1"
                  :class="{ invalid: !shutdownValid }"
                />
              </label>
              <label class="field">
                <span>Message (optional)</span>
                <input v-model="shutdownForm.message" maxlength="200" placeholder="Restarting for an update" />
              </label>
              <div class="form-actions">
                <button type="submit" class="btn-danger" :disabled="!shutdownValid || isBusy('shutdown')">
                  {{ shutdown ? 'Reschedule shutdown' : shutdownSeconds === 0 ? 'Shut down now' : 'Schedule shutdown' }}
                </button>
                <span v-if="!shutdownValid" class="hint err">Enter a whole number between 0 and 3600.</span>
              </div>
            </form>
          </section>

          <section class="panel">
            <div class="panel-head"><h3>Reload</h3></div>
            <p class="panel-note">Hot-reload server data from disk without a restart.</p>
            <div class="table-wrap plain">
              <table class="table-compact">
                <tbody>
                  <tr v-for="r in RELOAD_TARGETS" :key="r.target">
                    <td>
                      <strong>{{ r.label }}</strong>
                      <div class="hint">{{ r.hint }}</div>
                    </td>
                    <td class="wrap small">
                      <template v-if="reloadResults[r.target]">
                        <span :class="reloadResults[r.target].ok ? 'ok-text' : 'err'">{{ reloadResults[r.target].detail }}</span>
                        <span class="dim ml">· {{ formatTime(reloadResults[r.target].at) }}</span>
                      </template>
                    </td>
                    <td class="actions">
                      <button type="button" class="btn-sm" :disabled="isBusy(`reload-${r.target}`)" @click="reload(r.target)">
                        <span v-if="isBusy(`reload-${r.target}`)" class="spinner sm"></span> Reload
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </AsyncState>
  </div>
</template>
