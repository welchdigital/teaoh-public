import { reactive } from 'vue';

export const toasts = reactive([]);

let nextId = 1;

export function errorMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

export function dismiss(id) {
  const index = toasts.findIndex((t) => t.id === id);
  if (index !== -1) toasts.splice(index, 1);
}

function push(type, text, timeout) {
  const id = nextId;
  nextId += 1;
  toasts.push({ id, type, text: String(text) });
  while (toasts.length > 5) toasts.shift();
  setTimeout(() => dismiss(id), timeout);
  return id;
}

export const toast = {
  success: (text) => push('success', text, 3500),
  info: (text) => push('info', text, 5000),
  error: (err) => push('error', errorMessage(err), 8000),
};
