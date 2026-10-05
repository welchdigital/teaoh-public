import { reactive } from 'vue';

const DEFAULTS = {
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Confirm',
  cancelLabel: 'Cancel',
  danger: false,
  requireText: '',
};

export const confirmState = reactive({ ...DEFAULTS, open: false, resolve: null });

export function settleConfirm(value) {
  const resolve = confirmState.resolve;
  confirmState.open = false;
  confirmState.resolve = null;
  if (resolve) resolve(value);
}

export function confirm(options) {
  if (confirmState.resolve) settleConfirm(false);
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => {
    Object.assign(confirmState, DEFAULTS, opts, { open: true, resolve });
  });
}
