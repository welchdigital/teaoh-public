import type { Character } from '../../../character/character.ts';
import type { GameMap } from '../game-map.ts';

export function partyMemberIds(map: GameMap, playerId: number): number[] {
  return map.deps.parties?.partyOf(playerId)?.memberIds ?? [];
}

export function hasOpenCaptcha(map: GameMap, playerId: number): boolean {
  return (map.players.get(playerId)?.captcha ?? null) !== null;
}

export function isTargetable(map: GameMap, character: Character): boolean {
  return (
    character.row.hidden !== 1 &&
    character.row.hp > 0 &&
    map.characters.has(character.playerId) &&
    !hasOpenCaptcha(map, character.playerId)
  );
}

export function publicPlayerId(character: Character): number {
  return character.row.hidden === 1 ? 0 : character.playerId;
}

export function hpPercentage(hp: number, maxHp: number): number {
  return Math.min(100, Math.max(0, Math.floor((hp / Math.max(1, maxHp)) * 100)));
}
