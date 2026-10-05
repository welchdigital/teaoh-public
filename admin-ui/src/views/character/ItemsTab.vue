<script setup>
import { computed, reactive } from 'vue';
import { api } from '../../api.js';
import ItemPicker from '../../components/ItemPicker.vue';
import Modal from '../../components/Modal.vue';
import { useAction } from '../../composables/useAction.js';
import { formatNumber, toInt } from '../../util.js';

const props = defineProps({ character: { type: Object, required: true } });
const emit = defineEmits(['updated', 'refresh', 'deleted']);

const { isBusy, run } = useAction();

const give = reactive({ itemId: null, itemName: '', amount: 1 });
const giveAmount = computed(() => toInt(give.amount));
const canGive = computed(() => give.itemId !== null && giveAmount.value !== null && giveAmount.value >= 1);

function onPick(entry) {
  give.itemName = entry ? entry.name : '';
}

function handleResult(result) {
  if (result && typeof result === 'object' && 'baseStats' in result) emit('updated', result);
  else emit('refresh');
}

async function giveItem() {
  if (!canGive.value) return;
  const amount = giveAmount.value;
  const name = give.itemName || `item #${give.itemId}`;
  const result = await run(() => api.giveItem(props.character.id, give.itemId, amount), {
    key: 'give',
    success: `Gave ${formatNumber(amount)} × ${name} to ${props.character.name}`,
    failure: 'Give item failed',
  });
  if (result) {
    handleResult(result);
    give.amount = 1;
  }
}

const removal = reactive({ item: null, all: true, amount: 1 });
const removeAmount = computed(() => toInt(removal.amount));
const canRemove = computed(
  () =>
    removal.item !== null &&
    (removal.all || (removeAmount.value !== null && removeAmount.value >= 1 && removeAmount.value <= removal.item.amount)),
);

function openRemove(item) {
  removal.item = item;
  removal.all = true;
  removal.amount = item.amount;
}

async function confirmRemove() {
  if (!canRemove.value) return;
  const item = removal.item;
  const amount = removal.all ? null : removeAmount.value;
  const result = await run(() => api.removeItem(props.character.id, item.id, amount), {
    key: 'remove',
    success: `Removed ${amount === null ? 'all' : formatNumber(amount)} × ${item.name} from ${props.character.name}`,
    failure: 'Remove item failed',
  });
  if (result) {
    removal.item = null;
    handleResult(result);
  }
}

const inventory = computed(() => props.character.inventory || []);
const bank = computed(() => props.character.bank || []);
</script>

<template>
  <div class="stack">
    <section class="panel">
      <div class="panel-head"><h3>Give item</h3></div>
      <form class="row" style="align-items: flex-end" @submit.prevent="giveItem">
        <div class="field" style="flex: 2 1 260px">
          <span class="field-label">Item</span>
          <ItemPicker v-model="give.itemId" @select="onPick" />
        </div>
        <label class="field" style="flex: 0 1 130px">
          <span>Amount</span>
          <input v-model="give.amount" type="number" min="1" step="1" :class="{ invalid: giveAmount === null || giveAmount < 1 }" />
        </label>
        <button type="submit" class="btn-accent" :disabled="!canGive || isBusy('give')">
          <span v-if="isBusy('give')" class="spinner sm"></span> Give
        </button>
      </form>
      <p class="hint" style="margin: 0.6rem 0 0">
        {{ character.online ? 'The item is added to the live inventory and the client is refreshed.' : 'The item is written to the saved inventory.' }}
      </p>
    </section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head">
          <h3>Inventory <span class="dim">({{ inventory.length }})</span></h3>
          <span class="dim small">Gold: <span class="mono">{{ formatNumber(character.gold) }}</span></span>
        </div>
        <div v-if="inventory.length" class="table-wrap plain" style="max-height: 480px">
          <table class="table-compact">
            <thead>
              <tr><th>Item</th><th>Id</th><th class="num">Amount</th><th class="actions"><span class="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              <tr v-for="it in inventory" :key="it.id">
                <td>{{ it.name }}</td>
                <td class="mono dim">{{ it.id }}</td>
                <td class="num mono">{{ formatNumber(it.amount) }}</td>
                <td class="actions">
                  <button type="button" class="btn-sm btn-danger" @click="openRemove(it)">Remove…</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state">Inventory is empty.</div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h3>Bank <span class="dim">({{ bank.length }})</span></h3>
          <span class="dim small">
            <span class="mono">{{ formatNumber(character.bankGold) }}</span> gold · vault level {{ character.bankLevel }}
          </span>
        </div>
        <div v-if="bank.length" class="table-wrap plain" style="max-height: 480px">
          <table class="table-compact">
            <thead>
              <tr><th>Item</th><th>Id</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr v-for="it in bank" :key="it.id">
                <td>{{ it.name }}</td>
                <td class="mono dim">{{ it.id }}</td>
                <td class="num mono">{{ formatNumber(it.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="state">Bank is empty.</div>
      </section>
    </div>

    <Modal :open="removal.item !== null" :title="removal.item ? `Remove ${removal.item.name}` : ''" width="420px" @close="removal.item = null">
      <form v-if="removal.item" class="form-stack" @submit.prevent="confirmRemove">
        <p>
          {{ character.name }} holds <strong class="mono">{{ formatNumber(removal.item.amount) }}</strong> × {{ removal.item.name }}.
        </p>
        <label class="check">
          <input v-model="removal.all" type="radio" :value="true" name="remove-mode" /> Remove all
        </label>
        <label class="check">
          <input v-model="removal.all" type="radio" :value="false" name="remove-mode" /> Remove
          <input
            v-model="removal.amount"
            type="number"
            min="1"
            :max="removal.item.amount"
            step="1"
            :disabled="removal.all"
            :class="{ invalid: !removal.all && !canRemove }"
            aria-label="Amount to remove"
          />
        </label>
        <div class="modal-actions">
          <button type="button" @click="removal.item = null">Cancel</button>
          <button type="submit" class="btn-danger-solid" :disabled="!canRemove || isBusy('remove')">Remove</button>
        </div>
      </form>
    </Modal>
  </div>
</template>
