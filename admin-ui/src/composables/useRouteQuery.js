import { reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

function coerce(raw, fallback) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === null) return fallback;
  if (typeof fallback === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  if (typeof fallback === 'boolean') return value === 'true' || value === '1';
  return String(value);
}

export function useRouteQuery(defaults) {
  const route = useRoute();
  const router = useRouter();
  const name = route.name;
  const keys = Object.keys(defaults);
  const state = reactive({ ...defaults });

  function read() {
    for (const key of keys) {
      const next = coerce(route.query[key], defaults[key]);
      if (state[key] !== next) state[key] = next;
    }
  }

  read();

  watch(
    () => route.query,
    () => {
      if (route.name === name) read();
    },
  );

  watch(
    () => keys.map((key) => state[key]),
    () => {
      if (route.name !== name) return;
      const query = { ...route.query };
      for (const key of keys) {
        const value = state[key];
        if (value === defaults[key] || value === '' || value === null || value === undefined) delete query[key];
        else query[key] = String(value);
      }
      const same =
        Object.keys(query).length === Object.keys(route.query).length &&
        Object.entries(query).every(([k, v]) => route.query[k] === v);
      if (!same) router.replace({ query });
    },
  );

  return state;
}
