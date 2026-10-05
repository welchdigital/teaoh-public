import {
  ArenaAcceptServerPacket,
  ArenaDropServerPacket,
  ArenaSpecServerPacket,
  ArenaUseServerPacket,
  TalkServerServerPacket,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import type { Arena } from '../../../data/arenas.ts';
import { lang } from '../../../lang.ts';
import { log } from '../../../log.ts';
import type { Player } from '../../../player/player.ts';
import { distance } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';

export interface ArenaPlayer {
  playerId: number;
  kills: number;
}

export function arenaFor(map: GameMap): Arena | undefined {
  return map.deps.arenas?.forMap(map.id);
}

export function isArenaPlayer(map: GameMap, playerId: number): boolean {
  return map.arenaPlayers.some((p) => p.playerId === playerId);
}

function onLaunchTile(arena: Arena, character: Character): boolean {
  return arena.spawns.some((s) => s.from.x === character.row.x && s.from.y === character.row.y);
}

export function timedArena(map: GameMap): void {
  const arena = arenaFor(map);
  if (arena === undefined) return;

  const present = map.arenaPlayers.filter((p) => map.characters.has(p.playerId));
  if (present.length !== map.arenaPlayers.length) {
    map.arenaPlayers = present;
    if (present.length === 1) abandonArena(map);
  }

  map.arenaTicks++;
  if (map.arenaTicks < arena.rate) return;
  map.arenaTicks = 0;

  if (map.arenaPlayers.length >= arena.block) {
    map.broadcast(new ArenaDropServerPacket());
    return;
  }

  const queued: { player: Player; x: number; y: number }[] = [];
  for (const [playerId, character] of map.characters) {
    if (isArenaPlayer(map, playerId)) continue;
    const spawn = arena.spawns.find(
      (s) => s.from.x === character.row.x && s.from.y === character.row.y,
    );
    const player = map.players.get(playerId);
    if (spawn === undefined || player === undefined) continue;
    queued.push({ player, x: spawn.to.x, y: spawn.to.y });
  }

  if (queued.length === 0 || (map.arenaPlayers.length === 0 && queued.length === 1)) return;

  const launch = new ArenaUseServerPacket();
  launch.playersCount = queued.length;
  map.broadcast(launch);

  for (const entry of queued) {
    entry.player.requestWarp(map.id, entry.x, entry.y, true);
    map.arenaPlayers.push({ playerId: entry.player.id, kills: 0 });
  }
  log.info({ cat: 'arena', map: map.id, players: queued.length }, 'arena launched');
}

export function abandonArena(map: GameMap): void {
  const remaining = map.arenaPlayers;
  map.arenaPlayers = [];
  for (const entry of remaining) {
    const player = map.players.get(entry.playerId);
    if (player === undefined) continue;
    const message = new TalkServerServerPacket();
    message.message = lang('arena_aborted');
    player.bus.send(message);
    player.arenaDie(map.emf.relogX, map.emf.relogY);
  }
}

export function arenaLeave(map: GameMap, playerId: number, character: Character | undefined): void {
  const arena = arenaFor(map);
  if (arena === undefined || !isArenaPlayer(map, playerId)) return;
  if (character !== undefined && onLaunchTile(arena, character)) return;
  map.arenaPlayers = map.arenaPlayers.filter((p) => p.playerId !== playerId);
  if (map.arenaPlayers.length === 1) abandonArena(map);
}

export function arenaAttack(
  map: GameMap,
  player: Player,
  character: Character,
  victim: Character,
  direction: number,
): void {
  if (!isArenaPlayer(map, victim.playerId)) return;
  if (distance(character.row.x, character.row.y, victim.row.x, victim.row.y) > 1) return;
  const entry = map.arenaPlayers.find((p) => p.playerId === character.playerId);
  if (entry === undefined) return;

  entry.kills++;
  map.arenaPlayers = map.arenaPlayers.filter((p) => p.playerId !== victim.playerId);
  const victimPlayer = map.players.get(victim.playerId);
  const { relogX, relogY } = map.emf;

  if (map.arenaPlayers.length === 1) {
    map.arenaPlayers = [];
    const end = new ArenaAcceptServerPacket();
    end.winnerName = character.name;
    end.killsCount = entry.kills;
    end.killerName = character.name;
    end.victimName = victim.name;
    map.broadcast(end);
    log.info({ cat: 'arena', map: map.id, winner: character.name, kills: entry.kills }, 'arena won');
    victimPlayer?.arenaDie(relogX, relogY);
    player.arenaDie(relogX, relogY);
    return;
  }

  const spec = new ArenaSpecServerPacket();
  spec.playerId = character.playerId;
  spec.direction = direction;
  spec.killsCount = entry.kills;
  spec.killerName = character.name;
  spec.victimName = victim.name;
  map.broadcast(spec);
  victimPlayer?.arenaDie(relogX, relogY);
}
