import { Direction } from 'eolib';

export function step(x: number, y: number, direction: number): { x: number; y: number } {
  switch (direction) {
    case Direction.Down:
      return { x, y: y + 1 };
    case Direction.Left:
      return { x: x - 1, y };
    case Direction.Up:
      return { x, y: y - 1 };
    case Direction.Right:
      return { x: x + 1, y };
    default:
      return { x, y };
  }
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function inClientRange(observerX: number, observerY: number, x: number, y: number): boolean {
  const range = observerX < x && observerY < y ? 14 : 11;
  return distance(observerX, observerY, x, y) <= range;
}

export function inRange(observerX: number, observerY: number, x: number, y: number): boolean {
  const range = observerX < x && observerY < y ? 15 : 12;
  return distance(observerX, observerY, x, y) <= range;
}

export function directionTo(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Direction.Right : Direction.Left;
  return dy >= 0 ? Direction.Down : Direction.Up;
}
