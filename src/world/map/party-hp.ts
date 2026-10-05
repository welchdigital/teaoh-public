import { PartyAgreeServerPacket } from 'eolib';
import type { Character } from '../../character/character.ts';
import type { GameMap } from './game-map.ts';

export function broadcastPartyHp(map: GameMap, character: Character): void {
  const party = map.deps.parties?.partyOf(character.playerId);
  if (party === undefined) return;
  const update = new PartyAgreeServerPacket();
  update.playerId = character.playerId;
  update.hpPercentage = Math.min(
    100,
    Math.floor((character.row.hp / Math.max(1, character.maxHp)) * 100),
  );
  for (const memberId of party.memberIds) {
    map.deps.getPlayer?.(memberId)?.bus.send(update);
  }
}
