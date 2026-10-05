import { RecoverPlayerServerPacket } from 'eolib';
import type { Character } from '../../../character/character.ts';
import { log } from '../../../log.ts';
import type { Player } from '../../../player/player.ts';
import { killedPlayer } from '../../../quest/engine.ts';
import type { GameMap } from '../game-map.ts';
import { broadcastPartyHp } from '../party-hp.ts';

export function finishPlayerHit(
  map: GameMap,
  killerPlayer: Player,
  killer: Character,
  victim: Character,
): void {
  const victimPlayer = map.players.get(victim.playerId);
  if (victimPlayer === undefined) return;

  if (victim.row.hp === 0) {
    log.info({ cat: 'pk', killer: killer.name, victim: victim.name, map: map.id }, 'player killed');
    victimPlayer.die();
    killedPlayer(killerPlayer);
  }

  const recover = new RecoverPlayerServerPacket();
  recover.hp = victim.row.hp;
  recover.tp = victim.row.tp;
  victimPlayer.bus.send(recover);

  broadcastPartyHp(map, victim);
}
