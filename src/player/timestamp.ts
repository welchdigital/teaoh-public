export const MAX_TIMESTAMP = 8640000;
export const TIMESTAMP_WRAP_WINDOW = 360000;

export function timestampDiff(a: number, b: number): number {
  if (a === -1) return b;
  if (b === -1) return a;
  if (a >= b) return a - b;
  if (b >= MAX_TIMESTAMP - TIMESTAMP_WRAP_WINDOW && a < TIMESTAMP_WRAP_WINDOW) return a - b + MAX_TIMESTAMP;
  return a - b;
}
