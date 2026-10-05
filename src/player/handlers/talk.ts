import {
  AdminLevel,
  EoReader,
  PacketAction,
  TalkAdminClientPacket,
  TalkAnnounceClientPacket,
  TalkMsgClientPacket,
  TalkMsgServerPacket,
  TalkOpenClientPacket,
  TalkOpenServerPacket,
  TalkReply,
  TalkReplyServerPacket,
  TalkReportClientPacket,
  TalkRequestClientPacket,
  TalkRequestServerPacket,
  TalkSpecServerPacket,
  TalkTellClientPacket,
  TalkTellServerPacket,
} from 'eolib';
import { broadcastAdminMessage, broadcastAnnouncement } from '../../admin/actions.ts';
import { chatLog } from '../../admin/chat-log.ts';
import { activeMute } from '../../admin/mutes.ts';
import { lang } from '../../lang.ts';
import { log } from '../../log.ts';
import { talk } from '../../world/map/character/talk.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { handleAdminCommand, handlePlayerCommand } from './admin-commands.ts';
import { findOnlinePlayer, inGame } from './common.ts';
import { acceptsWhispers } from './global.ts';

const MAX_MESSAGE = 128;

function clip(message: string): string {
  return message.slice(0, MAX_MESSAGE);
}

export function chatBlocked(player: Player): boolean {
  const character = player.character;
  if (character === null) return true;
  const mute = activeMute(player.server, character.id);
  player.muted = mute !== null;
  if (mute === null) return false;
  const spec = new TalkSpecServerPacket();
  spec.adminName = mute.mutedBy ?? 'Server';
  player.bus.send(spec);
  return true;
}

function sendMapChat(player: Player, message: string): void {
  if (chatBlocked(player)) return;
  const character = player.character!;
  chatLog.record({ channel: 'local', from: character.name, map: character.mapId, message });
  talk(player.map!, player.id, message);
}

async function talkReport(player: Player, reader: EoReader): Promise<void> {
  const packet = TalkReportClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const message = clip(packet.message);
  if (message.length === 0) return;
  const character = player.character!;

  if (message.startsWith('$') && character.row.admin_level !== AdminLevel.Player) {
    if (await handleAdminCommand(player, message)) return;
  } else if (message.startsWith('#')) {
    if (handlePlayerCommand(player, message)) return;
  }
  if (!inGame(player)) return;
  sendMapChat(player, message);
}

function talkMsg(player: Player, reader: EoReader): void {
  const packet = TalkMsgClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const message = clip(packet.message);
  if (message.length === 0 || chatBlocked(player)) return;

  if (player.server.globalLocked) {
    const notice = new TalkMsgServerPacket();
    notice.playerName = 'Server';
    notice.message = lang('global_locked');
    player.bus.send(notice);
    return;
  }

  const character = player.character!;
  chatLog.record({ channel: 'global', from: character.name, map: character.mapId, message });
  const broadcast = new TalkMsgServerPacket();
  broadcast.playerName = character.name;
  broadcast.message = message;
  for (const other of player.server.allPlayers()) {
    if (other.id !== player.id && other.state === ClientState.InGame) other.bus.send(broadcast);
  }
}

function talkTell(player: Player, reader: EoReader): void {
  const packet = TalkTellClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const message = clip(packet.message);
  if (message.length === 0 || chatBlocked(player)) return;

  const target = findOnlinePlayer(player.server, packet.name);
  if (target === undefined || !acceptsWhispers(target)) {
    const reply = new TalkReplyServerPacket();
    reply.replyCode = TalkReply.NotFound;
    reply.name = packet.name;
    player.bus.send(reply);
    return;
  }

  const character = player.character!;
  chatLog.record({ channel: 'pm', from: character.name, to: target.character!.name, message });
  const tell = new TalkTellServerPacket();
  tell.playerName = character.name;
  tell.message = message;
  target.bus.send(tell);
}

function talkOpen(player: Player, reader: EoReader): void {
  const packet = TalkOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const message = clip(packet.message);
  if (message.length === 0) return;

  const party = player.server.parties.partyOf(player.id);
  if (party === undefined || chatBlocked(player)) return;

  const character = player.character!;
  chatLog.record({ channel: 'party', from: character.name, map: character.mapId, message });
  const chat = new TalkOpenServerPacket();
  chat.playerId = player.id;
  chat.message = message;
  for (const memberId of party.memberIds) {
    if (memberId !== player.id) player.server.getPlayer(memberId)?.bus.send(chat);
  }
}

function talkRequest(player: Player, reader: EoReader): void {
  const packet = TalkRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  if (character.guildTag === null) return;
  const message = clip(packet.message);
  if (message.length === 0 || chatBlocked(player)) return;

  chatLog.record({ channel: 'guild', from: character.name, to: character.guildTag, map: character.mapId, message });
  const relay = new TalkRequestServerPacket();
  relay.playerName = character.name;
  relay.message = message;
  for (const other of player.server.allPlayers()) {
    if (
      other.id !== player.id &&
      other.state === ClientState.InGame &&
      other.character?.guildTag === character.guildTag
    ) {
      other.bus.send(relay);
    }
  }
}

function talkAnnounce(player: Player, reader: EoReader): void {
  const packet = TalkAnnounceClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  if (character.row.admin_level < AdminLevel.Guardian) return;
  const message = clip(packet.message);
  if (message.length === 0 || chatBlocked(player)) return;

  chatLog.record({ channel: 'announce', from: character.name, map: character.mapId, message });
  broadcastAnnouncement(player.server, character.name, message, false);
}

function talkAdmin(player: Player, reader: EoReader): void {
  const packet = TalkAdminClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  if (character.row.admin_level < AdminLevel.Guardian) return;
  const message = clip(packet.message);
  if (message.length === 0 || chatBlocked(player)) return;

  chatLog.record({ channel: 'admin', from: character.name, map: character.mapId, message });
  broadcastAdminMessage(player.server, character.name, message);
}

export function handleTalk(player: Player, action: number, reader: EoReader): void | Promise<void> {
  switch (action) {
    case PacketAction.Report:
      return talkReport(player, reader);
    case PacketAction.Msg:
      return talkMsg(player, reader);
    case PacketAction.Tell:
      return talkTell(player, reader);
    case PacketAction.Open:
      return talkOpen(player, reader);
    case PacketAction.Request:
      return talkRequest(player, reader);
    case PacketAction.Announce:
      return talkAnnounce(player, reader);
    case PacketAction.Admin:
      return talkAdmin(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Talk action');
  }
}
