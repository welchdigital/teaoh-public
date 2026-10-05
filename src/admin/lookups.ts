import type { DropTables } from '../data/drops.ts';
import type { PubData } from '../data/pub-data.ts';

export type Resolution = { ok: true; id: number; name: string } | { ok: false; error: string };

interface NamedRecord {
  name: string;
}

const MAX_LISTED_IDS = 10;

function usable(record: NamedRecord | undefined): record is NamedRecord {
  return record !== undefined && record.name !== '' && record.name.toLowerCase() !== 'eof';
}

function describeIds(ids: number[]): string {
  const shown = ids.slice(0, MAX_LISTED_IDS).join(', ');
  return ids.length > MAX_LISTED_IDS ? `[${shown}, ...]` : `[${shown}]`;
}

export function resolveRecord(
  records: readonly NamedRecord[],
  identifier: string,
  kind: string,
  firstExact = false,
): Resolution {
  const text = identifier.trim();
  if (text === '') return { ok: false, error: `No ${kind} found with name "${identifier}".` };
  if (/^\d+$/.test(text)) {
    const id = Number.parseInt(text, 10);
    const record = records[id - 1];
    if (!Number.isSafeInteger(id) || id < 1 || !usable(record)) {
      return { ok: false, error: `No ${kind} found with id ${text}.` };
    }
    return { ok: true, id, name: record.name };
  }

  const lower = text.toLowerCase();
  const tiers: Array<(name: string) => boolean> = [
    (name) => name === lower,
    (name) => name.startsWith(lower),
    (name) => name.includes(lower),
  ];
  for (const [tier, matches] of tiers.entries()) {
    const ids: number[] = [];
    records.forEach((record, index) => {
      if (usable(record) && matches(record.name.toLowerCase())) ids.push(index + 1);
    });
    if (ids.length === 1 || (ids.length > 1 && firstExact && tier === 0)) {
      return { ok: true, id: ids[0]!, name: records[ids[0]! - 1]!.name };
    }
    if (ids.length > 1) {
      return { ok: false, error: `Multiple ${kind}s found with name "${text}": IDs ${describeIds(ids)}.` };
    }
  }
  return { ok: false, error: `No ${kind} found with name "${text}".` };
}

export function resolveItem(pub: PubData, identifier: string): Resolution {
  return resolveRecord(pub.eif?.parsed.items ?? [], identifier, 'item');
}

export function resolveNpc(pub: PubData, identifier: string): Resolution {
  return resolveRecord(pub.enf?.parsed.npcs ?? [], identifier, 'npc', true);
}

export function itemName(pub: PubData, id: number): string {
  if (id <= 0) return '';
  return pub.eif?.parsed.items[id - 1]?.name ?? `item ${id}`;
}

export function npcName(pub: PubData, id: number): string {
  if (id <= 0) return '';
  return pub.enf?.parsed.npcs[id - 1]?.name ?? `npc ${id}`;
}

export function spellName(pub: PubData, id: number): string {
  if (id <= 0) return '';
  return pub.esf?.parsed.skills[id - 1]?.name ?? `spell ${id}`;
}

export function className(pub: PubData, id: number): string {
  if (id <= 0) return '';
  return pub.ecf?.parsed.classes[id - 1]?.name ?? `class ${id}`;
}

export function isItemId(pub: PubData, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && usable(pub.eif?.parsed.items[id - 1]);
}

export function isNpcId(pub: PubData, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && usable(pub.enf?.parsed.npcs[id - 1]);
}

export function isClassId(pub: PubData, id: number): boolean {
  return Number.isInteger(id) && id >= 1 && usable(pub.ecf?.parsed.classes[id - 1]);
}

function search<T extends NamedRecord, R>(
  records: readonly T[],
  q: string | undefined,
  limit: number,
  map: (record: T, id: number) => R,
): R[] {
  const text = q?.trim().toLowerCase() ?? '';
  const exactId = /^\d+$/.test(text) ? Number.parseInt(text, 10) : null;
  const out: R[] = [];
  for (let index = 0; index < records.length && out.length < limit; index++) {
    const record = records[index]!;
    if (!usable(record)) continue;
    const id = index + 1;
    if (text !== '' && id !== exactId && !record.name.toLowerCase().includes(text)) continue;
    out.push(map(record, id));
  }
  return out;
}

export function lookupItems(pub: PubData, q: string | undefined, limit: number) {
  return search(pub.eif?.parsed.items ?? [], q, limit, (record, id) => ({
    id,
    name: record.name,
    type: record.type,
    subtype: record.subtype,
  }));
}

export function lookupNpcs(pub: PubData, q: string | undefined, limit: number) {
  return search(pub.enf?.parsed.npcs ?? [], q, limit, (record, id) => ({
    id,
    name: record.name,
    type: record.type,
    level: record.level,
    hp: record.hp,
  }));
}

export function lookupSpells(pub: PubData, q: string | undefined, limit: number) {
  return search(pub.esf?.parsed.skills ?? [], q, limit, (record, id) => ({
    id,
    name: record.name,
    type: record.type,
  }));
}

export function lookupClasses(pub: PubData) {
  return search(pub.ecf?.parsed.classes ?? [], undefined, Number.MAX_SAFE_INTEGER, (record, id) => ({
    id,
    name: record.name,
  }));
}

export interface DialogRow {
  left: string;
  right: string;
}

function percent(rate: number): string {
  return `${((rate / 64_000) * 100).toFixed(2)}%`;
}

function npcDrops(drops: DropTables, npcId: number) {
  const global = new Set(drops.global);
  return drops.candidates(npcId).filter((drop) => !global.has(drop));
}

function withHeader(lines: DialogRow[]): DialogRow[] {
  if (lines.length === 0) return lines;
  return [{ left: ' ', right: '' }, { left: 'Drops:', right: '' }, ...lines];
}

export function itemDropLines(pub: PubData, drops: DropTables, itemId: number): DialogRow[] {
  const lines: DialogRow[] = [];
  const npcs = pub.enf?.parsed.npcs ?? [];
  for (let index = 0; index < npcs.length; index++) {
    const npc = npcs[index];
    if (!usable(npc)) continue;
    const drop = npcDrops(drops, index + 1).find(
      (candidate) => candidate.itemId === itemId && candidate.min > 0 && candidate.max > 0,
    );
    if (drop !== undefined) lines.push({ left: npc.name, right: percent(drop.rate) });
  }
  return withHeader(lines);
}

export function npcDropLines(pub: PubData, drops: DropTables, npcId: number): DialogRow[] {
  const lines: DialogRow[] = [];
  const items = pub.eif?.parsed.items ?? [];
  for (const drop of npcDrops(drops, npcId)) {
    if (drop.min <= 0 || drop.max <= 0) continue;
    const item = items[drop.itemId - 1];
    if (!usable(item)) continue;
    lines.push({ left: item.name, right: percent(drop.rate) });
  }
  return withHeader(lines);
}
