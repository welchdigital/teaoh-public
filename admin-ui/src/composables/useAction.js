import { computed, reactive } from 'vue';
import { confirm } from '../stores/confirm.js';
import { toast } from '../stores/toasts.js';

export function useAction() {
  const pending = reactive(new Map());
  const errors = reactive({});
  const busy = computed(() => (pending.size ? [...pending.keys()][pending.size - 1] : null));

  function isBusy(key) {
    return pending.has(key);
  }

  function errorFor(key) {
    return errors[key] || '';
  }

  function clearError(key) {
    delete errors[key];
  }

  function begin(key) {
    pending.set(key, (pending.get(key) || 0) + 1);
  }

  function end(key) {
    const count = (pending.get(key) || 1) - 1;
    if (count <= 0) pending.delete(key);
    else pending.set(key, count);
  }

  async function run(fn, { confirm: confirmOptions, success, failure, key = 'action' } = {}) {
    if (confirmOptions) {
      const ok = await confirm(confirmOptions);
      if (!ok) return null;
    }
    begin(key);
    clearError(key);
    try {
      const result = await fn();
      if (success) toast.success(typeof success === 'function' ? success(result) : success);
      return result === null || result === undefined ? true : result;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      errors[key] = message;
      toast.error(failure ? `${failure}: ${message}` : message);
      return null;
    } finally {
      end(key);
    }
  }

  return { busy, isBusy, errorFor, clearError, run };
}
