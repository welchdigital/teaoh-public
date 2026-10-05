export function randomRange(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
