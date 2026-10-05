<script setup>
import { computed, reactive, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { api } from '../../api.js';
import DurationPicker from '../../components/DurationPicker.vue';
import MapSelect from '../../components/MapSelect.vue';
import StatusBadge from '../../components/StatusBadge.vue';
import TimeAgo from '../../components/TimeAgo.vue';
import { useAction } from '../../composables/useAction.js';
import { useModeration } from '../../composables/useModeration.js';
import { adminLabel, toInt } from '../../util.js';

const props = defineProps({ character: { type: Object, required: true } });
const emit = defineEmits(['updated', 'refresh', 'deleted']);

function isCharacterDetail(value) {
  return value && typeof value === 'object' && 'baseStats' in value && 'location' in value;
}

const moderation = useModeration((result) => {
  if (isCharacterDetail(result)) emit('updated', result);
  else emit('refresh');
});
const { isBusy, run } = useAction();

const c = computed(() => props.character);
const online = computed(() => Boolean(c.value.online));
const mod = computed(() => c.value.moderation || {});
const busyAny = computed(() => Boolean(moderation.busy.value));

const warp = reactive({ map: null, x: '', y: '' });
const mute = reactive({ duration: 60, valid: true, reason: '' });
const ban = reactive({ duration: 1440, valid: true, reason: '', banIp: false, banHdid: false, silent: false, force: false });
const message = reactive({ text: '' });
const kick = reactive({ silent: false });
const rename = reactive({ name: '' });

watch(
  () => c.value.id,
  () => {
    const loc = c.value.location || {};
    warp.map = loc.map ?? null;
    warp.x = loc.x ?? '';
    warp.y = loc.y ?? '';
    rename.name = '';
    message.text = '';
  },
  { immediate: true },
);

const warpError = computed(() => {
  const map = toInt(warp.map);
  if (map === null || map < 1) return 'Choose a map.';
  const hasX = warp.x !== '' && warp.x !== null;
  const hasY = warp.y !== '' && warp.y !== null;
  if (hasX !== hasY) return 'Enter both X and Y, or leave both blank.';
  if (hasX && (toInt(warp.x) === null || toInt(warp.y) === null || toInt(warp.x) < 0 || toInt(warp.y) < 0)) {
    return 'Coordinates must be whole numbers ≥ 0.';
  }
  return '';
});

function doWarp() {
  if (warpError.value) return;
  const hasCoords = warp.x !== '' && warp.x !== null;
  moderation.warp(c.value, {
    map: toInt(warp.map),
    x: hasCoords ? toInt(warp.x) : null,
    y: hasCoords ? toInt(warp.y) : null,
  });
}

async function doMute() {
  if (!mute.valid) return;
  const result = await moderation.mute(c.value, mute.duration, mute.reason.trim());
  if (result) mute.reason = '';
}

async function doBan() {
  if (!ban.valid) return;
  const result = await moderation.ban(c.value, {
    durationMinutes: ban.duration,
    reason: ban.reason.trim(),
    banIp: ban.banIp,
    banHdid: ban.banHdid,
    silent: ban.silent,
    force: ban.force,
  });
  if (result) ban.reason = '';
}

async function revokeBan() {
  const banId = mod.value.activeBanId;
  if (banId === null || banId === undefined) return;
  const result = await run(() => api.revokeBan(banId), {
    key: 'revoke',
    success: `Ban #${banId} revoked`,
    failure: 'Revoke failed',
  });
  if (result) emit('refresh');
}

async function sendMessage() {
  const text = message.text.trim();
  if (!text) return;
  const result = await moderation.message(c.value, text);
  if (result) message.text = '';
}

const renameValue = computed(() => rename.name.trim());
const canRename = computed(() => !online.value && renameValue.value.length > 0 && renameValue.value !== c.value.name);

async function doRename() {
  if (!canRename.value) return;
  const oldName = c.value.name;
  const newName = renameValue.value;
  const result = await run(() => api.renameCharacter(c.value.id, newName), {
    key: 'rename',
    confirm: {
      title: 'Rename character',
      message: `Rename ${oldName} to ${newName}?`,
      confirmLabel: 'Rename',
    },
    success: `Renamed ${oldName} to ${newName}`,
    failure: 'Rename failed',
  });
  if (result) {
    rename.name = '';
    if (isCharacterDetail(result)) emit('updated', result);
    else emit('refresh');
  }
}

async function doDelete() {
  const name = c.value.name;
  const result = await run(() => api.deleteCharacter(c.value.id), {
    key: 'delete',
    confirm: {
      title: 'Delete character',
      message: `Permanently delete ${name} and all of their items? This cannot be undone.`,
      confirmLabel: 'Delete character',
      danger: true,
      requireText: name,
    },
    success: `${name} deleted`,
    failure: 'Delete failed',
  });
  if (result) emit('deleted');
}
</script>

<template>
  <div class="stack">
    <div v-if="c.adminLevel > 0" class="banner banner-warn">
      <strong>⚠ Staff character</strong>
      <span class="banner-text">
        {{ c.name }} is a {{ adminLabel(c.adminLevel) }} (admin level {{ c.adminLevel }}). Make sure moderation is intended.
      </span>
    </div>

    <div class="grid-2">
      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <h3>Warp</h3>
            <span class="dim small mono">now: map {{ c.location?.map }} ({{ c.location?.x }}, {{ c.location?.y }})</span>
          </div>
          <form class="form-stack" @submit.prevent="doWarp">
            <label class="field">
              <span>Map</span>
              <MapSelect v-model="warp.map" />
            </label>
            <div class="form-grid">
              <label class="field"><span>X</span><input v-model="warp.x" type="number" min="0" step="1" /></label>
              <label class="field"><span>Y</span><input v-model="warp.y" type="number" min="0" step="1" /></label>
            </div>
            <div class="hint" :class="{ err: warpError }">
              {{ warpError || (online ? 'The character is moved immediately.' : 'Offline: the saved position is updated.') }}
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-accent" :disabled="Boolean(warpError) || moderation.isBusy('warp')">Warp</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-head"><h3>Jail &amp; freeze</h3></div>
          <div class="form-stack">
            <div class="row between">
              <span>
                Jail
                <StatusBadge :status="mod.jailed ? 'jailed' : 'free'" :tone="mod.jailed ? 'orange' : 'dim'" style="margin-left: 0.35rem" />
              </span>
              <button v-if="mod.jailed" type="button" :disabled="busyAny" @click="moderation.free(c)">Free from jail</button>
              <button v-else type="button" class="btn-danger" :disabled="busyAny" @click="moderation.jail(c)">Jail…</button>
            </div>
            <div class="row between">
              <span>
                Freeze
                <StatusBadge :status="mod.frozen ? 'frozen' : 'not frozen'" :tone="mod.frozen ? 'cyan' : 'dim'" style="margin-left: 0.35rem" />
              </span>
              <button
                v-if="mod.frozen"
                type="button"
                :disabled="!online || busyAny"
                :title="online ? '' : 'Only online characters can be unfrozen'"
                @click="moderation.unfreeze(c)"
              >
                Unfreeze
              </button>
              <button
                v-else
                type="button"
                class="btn-warn"
                :disabled="!online || busyAny"
                :title="online ? '' : 'Only online characters can be frozen'"
                @click="moderation.freeze(c)"
              >
                Freeze
              </button>
            </div>
            <div v-if="!online" class="hint">Freeze requires the character to be online.</div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Mute</h3>
            <StatusBadge v-if="mod.muted" status="muted" />
          </div>
          <div v-if="mod.muted" class="banner banner-warn" style="margin-bottom: 0.8rem">
            <span class="banner-text">Muted until <TimeAgo :value="mod.mutedUntil" empty="further notice" />.</span>
            <button type="button" class="btn-sm" :disabled="busyAny" @click="moderation.unmute(c)">Unmute</button>
          </div>
          <form class="form-stack" @submit.prevent="doMute">
            <div class="field">
              <span class="field-label">Duration</span>
              <DurationPicker v-model="mute.duration" v-model:valid="mute.valid" permanent-label="Indefinite" />
            </div>
            <label class="field">
              <span>Reason (optional)</span>
              <input v-model="mute.reason" maxlength="200" />
            </label>
            <div v-if="moderation.errorFor('mute')" class="hint err" role="alert">{{ moderation.errorFor('mute') }}</div>
            <div class="form-actions">
              <button type="submit" class="btn-warn" :disabled="!mute.valid || moderation.isBusy('mute')">
                {{ mod.muted ? 'Update mute' : 'Mute' }}
              </button>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Private message</h3>
            <StatusBadge v-if="!online" status="offline" label="online only" />
          </div>
          <form class="form-stack" @submit.prevent="sendMessage">
            <label class="field">
              <span>Message</span>
              <textarea v-model="message.text" rows="2" maxlength="200" :disabled="!online"></textarea>
              <span class="counter">{{ message.text.length }} / 200</span>
            </label>
            <div class="form-actions">
              <button type="submit" class="btn-accent" :disabled="!online || !message.text.trim() || moderation.isBusy('message')">
                Send
              </button>
              <span v-if="!online" class="hint">The character must be online.</span>
            </div>
          </form>
        </section>
      </div>

      <div class="stack">
        <section class="panel">
          <div class="panel-head">
            <h3>Kick</h3>
            <StatusBadge v-if="!online" status="offline" label="online only" />
          </div>
          <div class="form-stack">
            <label class="check">
              <input v-model="kick.silent" type="checkbox" :disabled="!online" /> Silent (no in-game announcement)
            </label>
            <div class="form-actions">
              <button
                type="button"
                class="btn-danger"
                :disabled="!online || busyAny"
                @click="moderation.kick(c, kick.silent)"
              >
                {{ kick.silent ? 'Silent kick…' : 'Kick…' }}
              </button>
              <span v-if="!online" class="hint">The character is offline.</span>
            </div>
          </div>
        </section>

        <section class="panel panel-danger">
          <div class="panel-head">
            <h3>Ban</h3>
            <StatusBadge v-if="mod.banned" status="banned" />
          </div>
          <div v-if="mod.banned" class="banner banner-err" style="margin-bottom: 0.8rem">
            <span class="banner-text">
              Account is banned
              <template v-if="mod.activeBanId !== null && mod.activeBanId !== undefined">
                (ban <RouterLink :to="{ name: 'bans', query: { active: 'true' } }">#{{ mod.activeBanId }}</RouterLink>)
              </template>.
            </span>
            <button
              v-if="mod.activeBanId !== null && mod.activeBanId !== undefined"
              type="button"
              class="btn-sm"
              :disabled="isBusy('revoke')"
              @click="revokeBan"
            >
              Revoke ban
            </button>
          </div>
          <form class="form-stack" @submit.prevent="doBan">
            <div class="field">
              <span class="field-label">Duration</span>
              <DurationPicker v-model="ban.duration" v-model:valid="ban.valid" />
            </div>
            <label class="field">
              <span>Reason</span>
              <input v-model="ban.reason" maxlength="200" placeholder="Shown in the ban list and audit log" />
            </label>
            <label class="check"><input v-model="ban.banIp" type="checkbox" /> Also ban the IP address</label>
            <label class="check"><input v-model="ban.banHdid" type="checkbox" /> Also ban the hardware ID</label>
            <label class="check"><input v-model="ban.silent" type="checkbox" /> Silent (no in-game announcement)</label>
            <details v-if="ban.banIp" class="advanced">
              <summary>Advanced</summary>
              <label class="check">
                <input v-model="ban.force" type="checkbox" /> Force the IP ban even for loopback or proxy addresses
              </label>
              <div class="hint">
                The server refuses to ban loopback and proxy addresses unless forced, because that can lock out
                everyone who connects through them.
              </div>
            </details>
            <div v-if="moderation.errorFor('ban')" class="hint err" role="alert">{{ moderation.errorFor('ban') }}</div>
            <div class="form-actions">
              <button type="submit" class="btn-danger" :disabled="!ban.valid || moderation.isBusy('ban')">Ban…</button>
              <span class="hint">{{ online ? 'The character will be disconnected.' : 'Works for offline characters.' }}</span>
            </div>
          </form>
        </section>

        <section class="panel">
          <div class="panel-head">
            <h3>Rename</h3>
            <StatusBadge v-if="online" status="online" label="offline only" tone="dim" />
          </div>
          <form class="form-stack" @submit.prevent="doRename">
            <label class="field">
              <span>New name</span>
              <input
                v-model="rename.name"
                maxlength="12"
                autocomplete="off"
                spellcheck="false"
                :placeholder="c.name"
                :disabled="online"
              />
            </label>
            <div class="form-actions">
              <button type="submit" :disabled="!canRename || isBusy('rename')">Rename…</button>
              <span v-if="online" class="hint">Kick the character first; renaming requires them to be offline.</span>
            </div>
          </form>
        </section>

        <section class="panel panel-danger">
          <div class="panel-head">
            <h3>Delete character</h3>
            <StatusBadge v-if="online" status="online" label="offline only" tone="dim" />
          </div>
          <p class="dim">Removes the character and all of their items permanently. You will be asked to type the name.</p>
          <div class="form-actions">
            <button type="button" class="btn-danger" :disabled="online || isBusy('delete')" @click="doDelete">
              Delete {{ c.name }}…
            </button>
            <span v-if="online" class="hint">The character must be offline.</span>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
