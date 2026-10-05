export const RELOAD_TARGETS = ['maps', 'pubs', 'drops', 'quests', 'formulas', 'news', 'shops', 'config'] as const;
export type ReloadTarget = (typeof RELOAD_TARGETS)[number];

export function isReloadTarget(value: unknown): value is ReloadTarget {
  return typeof value === 'string' && (RELOAD_TARGETS as readonly string[]).includes(value);
}
