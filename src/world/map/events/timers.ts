import { SitState } from 'eolib';
import { warpPending } from '../character/walk.ts';
import type { GameMap } from '../game-map.ts';
import { broadcastPartyHp } from '../party-hp.ts';
import { getWarp } from '../tiles.ts';

const WARP_SUCK_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

export function timedGhost(map: GameMap): void {
  for (const [playerId, ticks] of map.ghostTicks) {
    if (ticks > 0) map.ghostTicks.set(playerId, ticks - 1);
  }
}

export function timedWarpSuck(map: GameMap): void {
  for (const [playerId, character] of map.characters) {
    const player = map.players.get(playerId);
    if (player === undefined) continue;
    player.warpSuckTicks = Math.max(0, player.warpSuckTicks - 1);
    if (player.warpSuckTicks > 0) continue;
    player.warpSuckTicks = map.deps.config.world.warpSuckRate;
    if (player.frozen || warpPending(player)) continue;

    for (const [dx, dy] of WARP_SUCK_OFFSETS) {
      const x = character.row.x + dx;
      const y = character.row.y + dy;
      const warp = getWarp(map, x, y);
      if (warp === undefined || warp.destinationMap === 0) continue;
      if (warp.levelRequired > character.row.level || warp.door > 1) continue;
      player.requestWarp(warp.destinationMap, warp.x, warp.y, warp.destinationMap === map.id);
      break;
    }
  }
}

export function timedDropProtection(map: GameMap): void {
  for (const item of map.items.values()) {
    if (item.protectedTicks > 0) item.protectedTicks--;
  }
}

export function timedDoorClose(map: GameMap): void {
  const rate = map.deps.config.map.doorCloseRate;
  for (const door of map.doors.values()) {
    if (!door.open) continue;
    door.openTicks++;
    if (door.openTicks >= rate) {
      door.open = false;
      door.openTicks = 0;
    }
  }
}

export function recoverNpcs(map: GameMap): void {
  for (const npc of map.npcs.values()) {
    if (npc.alive && npc.hp < npc.maxHp) {
      npc.hp = Math.min(npc.hp + Math.floor(npc.maxHp / 10) + 1, npc.maxHp);
    }
  }
}

export function recoverPlayers(map: GameMap): void {
  for (const [playerId, character] of map.characters) {
    if (character.row.hp >= character.maxHp && character.row.tp >= character.maxTp) continue;
    const divisor = character.row.sitting === SitState.Stand ? 10 : 5;
    const hpBefore = character.row.hp;
    character.row.hp = Math.min(
      character.row.hp + Math.floor(character.maxHp / divisor) + 1,
      character.maxHp,
    );
    character.row.tp = Math.min(
      character.row.tp + Math.floor(character.maxTp / divisor) + 1,
      character.maxTp,
    );
    map.players.get(playerId)?.sendRecover();
    if (character.row.hp !== hpBefore) broadcastPartyHp(map, character);
  }
}
