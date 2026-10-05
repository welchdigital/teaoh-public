import { AdminLevel, MusicPlayerServerPacket, TalkServerServerPacket } from 'eolib';
import { lang } from '../../lang.ts';
import type { GameMap } from './game-map.ts';

export function isEvacuating(map: GameMap): boolean {
  return map.evacuateTicks !== null;
}

export function startEvacuate(map: GameMap, seconds?: number): boolean {
  if (map.evacuateTicks !== null) return false;
  const total = seconds ?? map.deps.config.evacuate.timerSeconds;
  map.evacuateTicks = Math.max(0, Math.floor(Number.isFinite(total) ? total : 0));
  return true;
}

export function cancelEvacuate(map: GameMap): boolean {
  if (map.evacuateTicks === null) return false;
  map.evacuateTicks = null;
  return true;
}

export function toggleEvacuate(map: GameMap, seconds?: number): boolean {
  if (cancelEvacuate(map)) return false;
  return startEvacuate(map, seconds);
}

function sendWarning(map: GameMap, last: boolean, seconds: number): void {
  const message = new TalkServerServerPacket();
  message.message = lang(last ? 'evacuate_last_warning' : 'evacuate_warning', { seconds });
  map.broadcast(message);
  const sound = new MusicPlayerServerPacket();
  sound.soundId = map.deps.config.evacuate.sfxId;
  map.broadcast(sound);
}

export function timedEvacuate(map: GameMap): void {
  const seconds = map.evacuateTicks;
  if (seconds === null) return;
  const step = Math.max(1, map.deps.config.evacuate.timerStep);

  if (seconds > 0 && seconds % step === 0 && seconds >= step * 2) sendWarning(map, false, seconds);
  if (seconds === step) sendWarning(map, true, seconds);

  if (seconds > 0) {
    map.evacuateTicks = seconds - 1;
    return;
  }

  map.evacuateTicks = null;
  const { jailMap, jailX, jailY } = map.deps.config.world;
  for (const [playerId, character] of map.characters) {
    if (character.row.admin_level !== AdminLevel.Player) continue;
    map.players.get(playerId)?.requestWarp(jailMap, jailX, jailY, jailMap === map.id);
  }
}
