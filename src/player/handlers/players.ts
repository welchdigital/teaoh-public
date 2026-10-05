import {
  AdminLevel,
  CharacterIcon,
  EoReader,
  InitInitServerPacket,
  InitReply,
  OnlinePlayer,
  PacketAction,
  PlayersAcceptClientPacket,
  PlayersList,
  PlayersListFriends,
  PlayersNet242ServerPacket,
  PlayersPingServerPacket,
  PlayersPongServerPacket,
} from 'eolib';
import type { Character } from '../../character/character.ts';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function onlinePlayers(player: Player): Player[] {
  return [...player.server.allPlayers()].filter(
    (p) =>
      p.state === ClientState.InGame &&
      p.character !== null &&
      (p.character.row.hidden !== 1 || p.id === player.id),
  );
}

export function iconFor(character: Character, inParty: boolean): CharacterIcon {
  switch (character.row.admin_level) {
    case AdminLevel.Guardian:
    case AdminLevel.GameMaster:
      return inParty ? CharacterIcon.GmParty : CharacterIcon.Gm;
    case AdminLevel.HighGameMaster:
      return inParty ? CharacterIcon.HgmParty : CharacterIcon.Hgm;
    default:
      return inParty ? CharacterIcon.Party : CharacterIcon.Player;
  }
}

function playersRequest(player: Player): void {
  const players = onlinePlayers(player).map((p) => {
    const character = p.character!;
    const entry = new OnlinePlayer();
    entry.name = character.name;
    entry.title = character.row.title ?? '';
    entry.level = character.row.level;
    entry.icon = iconFor(character, player.server.parties.partyOf(p.id) !== undefined);
    entry.classId = character.row.class;
    entry.guildTag = (character.guildTag ?? '').padEnd(3, ' ');
    return entry;
  });

  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.PlayersList;
  const data = new InitInitServerPacket.ReplyCodeDataPlayersList();
  const list = new PlayersList();
  list.players = players;
  data.playersList = list;
  reply.replyCodeData = data;
  player.bus.send(reply);
}

function playersList(player: Player): void {
  const names = onlinePlayers(player).map((p) => p.character!.name);

  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.PlayersListFriends;
  const data = new InitInitServerPacket.ReplyCodeDataPlayersListFriends();
  const list = new PlayersListFriends();
  list.players = names;
  data.playersList = list;
  reply.replyCodeData = data;
  player.bus.send(reply);
}

function playersAccept(player: Player, reader: EoReader): void {
  const packet = PlayersAcceptClientPacket.deserialize(reader);
  const target = packet.name.toLowerCase();
  const found = onlinePlayers(player).find((p) => p.character!.name === target);

  if (found !== undefined && player.map !== null && found.map === player.map) {
    const reply = new PlayersPongServerPacket();
    reply.name = packet.name;
    player.bus.send(reply);
  } else if (found !== undefined) {
    const reply = new PlayersNet242ServerPacket();
    reply.name = packet.name;
    player.bus.send(reply);
  } else {
    const reply = new PlayersPingServerPacket();
    reply.name = packet.name;
    player.bus.send(reply);
  }
}

export function handlePlayers(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      playersRequest(player);
      break;
    case PacketAction.List:
      playersList(player);
      break;
    case PacketAction.Accept:
      if (player.state === ClientState.InGame) playersAccept(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Players action');
  }
}
