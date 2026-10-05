import type { Config } from '../config.ts';

export function isProtectedItem(config: Pick<Config, 'items'>, itemId: number): boolean {
  return config.items.protectedItems.includes(itemId);
}

export function isInfiniteUseItem(config: Pick<Config, 'items'>, itemId: number): boolean {
  return config.items.infiniteUseItems.includes(itemId);
}
