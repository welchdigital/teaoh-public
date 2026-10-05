import { getCurrentScope, onScopeDispose, ref } from 'vue';

const clocks = new Map();

export function useNow(intervalMs = 1000) {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: ref(Date.now()), users: 0, timer: null };
    clocks.set(intervalMs, clock);
  }
  clock.users += 1;
  if (!clock.timer) {
    clock.now.value = Date.now();
    clock.timer = setInterval(() => {
      clock.now.value = Date.now();
    }, intervalMs);
  }
  if (getCurrentScope()) {
    onScopeDispose(() => {
      clock.users -= 1;
      if (clock.users <= 0 && clock.timer) {
        clearInterval(clock.timer);
        clock.timer = null;
      }
    });
  }
  return clock.now;
}
