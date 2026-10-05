import { CharacterDetails } from 'eolib';
import type { Character } from '../../character/character.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

export function inGame(player: Player): boolean {
  return player.state === ClientState.InGame && player.character !== null && player.map !== null;
}

export function findOnlinePlayer(
  server: Player['server'],
  name: string,
): Player | undefined {
  const target = name.toLowerCase();
  for (const other of server.allPlayers()) {
    if (other.state === ClientState.InGame && other.character?.name === target) return other;
  }
  return undefined;
}

export function hasLoadedCharacter(player: Player): boolean {
  return (
    (player.state === ClientState.InGame || player.state === ClientState.EnteringGame) &&
    player.character !== null
  );
}

export function findLoadedPlayer(
  server: Player['server'],
  name: string,
): Player | undefined {
  const target = name.toLowerCase();
  for (const other of server.allPlayers()) {
    if (hasLoadedCharacter(other) && other.character!.name === target) return other;
  }
  return undefined;
}

export function characterDetails(character: Character): CharacterDetails {
  const details = new CharacterDetails();
  details.name = character.name;
  details.home = character.row.home ?? '';
  details.partner = character.row.partner ?? '';
  details.title = character.row.title ?? '';
  details.guild = character.guildName ?? '';
  details.guildRank = character.row.guild_rank_string ?? '';
  details.playerId = character.playerId;
  details.classId = character.row.class;
  details.gender = character.row.gender;
  details.admin = character.row.admin_level;
  return details;
}

export function capitalize(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
