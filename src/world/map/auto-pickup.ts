import { TalkServerServerPacket } from 'eolib';
import type { Character } from '../../character/character.ts';
import type { Player } from '../../player/player.ts';
import { distance } from '../coords.ts';
import { showInfoBox } from '../info-box.ts';
import { getItem } from './character/items.ts';
import type { GameMap } from './game-map.ts';

const INVALID_ARGUMENT = 'Invalid argument. Must be "list", "add", or "remove".';

function serverMessage(player: Player, message: string): void {
  const packet = new TalkServerServerPacket();
  packet.message = message;
  player.bus.send(packet);
}

function itemName(map: GameMap, itemId: number): string | undefined {
  if (!Number.isInteger(itemId) || itemId < 1) return undefined;
  return map.deps.pubData.eif?.parsed.items[itemId - 1]?.name;
}

function resolveItemId(map: GameMap, identifier: string): number | null {
  if (/^\d+$/.test(identifier)) return Number.parseInt(identifier, 10);
  const lower = identifier.toLowerCase();
  const index = map.deps.pubData.eif?.parsed.items.findIndex((item) => item.name.toLowerCase() === lower);
  return index === undefined || index < 0 ? null : index + 1;
}

export function addAutoPickupItem(map: GameMap, player: Player, character: Character, itemId: number): void {
  const name = itemName(map, itemId);
  if (name === undefined) return;
  if (!character.autoPickupItems.includes(itemId)) character.autoPickupItems.push(itemId);
  serverMessage(player, `Auto-Pickup Item Added: ${name}`);
}

export function removeAutoPickupItem(map: GameMap, player: Player, character: Character, itemId: number): void {
  const name = itemName(map, itemId);
  if (name === undefined) return;
  character.autoPickupItems = character.autoPickupItems.filter((id) => id !== itemId);
  serverMessage(player, `Auto-Pickup Item Removed: ${name}`);
}

export function clearAutoPickupItems(player: Player, character: Character): void {
  character.autoPickupItems = [];
  serverMessage(player, 'Auto-Pickup Items Cleared');
}

export function listAutoPickupItems(map: GameMap, player: Player, character: Character): void {
  const names = character.autoPickupItems
    .map((itemId) => itemName(map, itemId))
    .filter((name) => name !== undefined);
  showInfoBox(player, 'Auto-Pickup Items:', names.length === 0 ? ['None'] : names);
}

export function handleAutoPickupCommand(player: Player, args: readonly string[]): boolean {
  const map = player.map;
  const character = player.character;
  if (map === null || character === null) return false;
  if (!map.deps.config.autoPickup.enabled) return true;

  const subCommand = (args[0] ?? 'list').toLowerCase();
  if (subCommand === 'list') {
    listAutoPickupItems(map, player, character);
    return true;
  }
  if (subCommand === 'clear') {
    clearAutoPickupItems(player, character);
    return true;
  }
  if (args.length < 2) {
    serverMessage(player, INVALID_ARGUMENT);
    return true;
  }

  const identifier = args.slice(1).join(' ');
  const itemId = resolveItemId(map, identifier);
  if (itemId === null) {
    serverMessage(player, `No item found with name "${identifier}".`);
    return true;
  }
  if (subCommand === 'add') addAutoPickupItem(map, player, character, itemId);
  else if (subCommand === 'remove') removeAutoPickupItem(map, player, character, itemId);
  else serverMessage(player, INVALID_ARGUMENT);
  return true;
}

export function timedAutoPickup(map: GameMap): void {
  if (map.items.size === 0) return;
  const collectors: [Player, Character][] = [];
  for (const [playerId, character] of map.characters) {
    if (character.autoPickupItems.length === 0) continue;
    const player = map.players.get(playerId);
    if (player === undefined || player.captcha != null) continue;
    collectors.push([player, character]);
  }
  if (collectors.length === 0) return;

  const range = map.deps.config.world.dropDistance;
  const matches: [number, Player, Character][] = [];
  for (const item of map.items.values()) {
    let best: [Player, Character] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [player, character] of collectors) {
      if (!character.autoPickupItems.includes(item.id)) continue;
      const d = distance(item.x, item.y, character.row.x, character.row.y);
      if (d > range || d >= bestDistance) continue;
      best = [player, character];
      bestDistance = d;
    }
    if (best !== null) matches.push([item.index, best[0], best[1]]);
  }

  for (const [index, player, character] of matches) {
    if (map.characters.get(character.playerId) === character) getItem(map, player, character, index);
  }
}
