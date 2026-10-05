import {
  EoReader,
  PacketAction,
  PartyAcceptClientPacket,
  PartyAddServerPacket,
  PartyCloseServerPacket,
  PartyCreateServerPacket,
  PartyListServerPacket,
  PartyMember,
  PartyRemoveClientPacket,
  PartyRemoveServerPacket,
  PartyReplyCode,
  PartyReplyServerPacket,
  PartyRequestClientPacket,
  PartyRequestServerPacket,
  PartyRequestType,
  PartyTakeClientPacket,
} from 'eolib';
import { log } from '../../log.ts';
import { inClientRange } from '../../world/coords.ts';
import { hpPercentage } from '../../world/map/combat/targets.ts';
import type { Party } from '../../world/party.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

function memberInfo(player: Player, party: Party): PartyMember | null {
  const character = player.character;
  if (character === null) return null;
  const member = new PartyMember();
  member.playerId = player.id;
  member.leader = party.leaderId === player.id;
  member.level = character.row.level;
  member.hpPercentage = hpPercentage(character.row.hp, character.maxHp);
  member.name = character.name;
  return member;
}

function membersList(server: Player['server'], party: Party): PartyMember[] {
  const members: PartyMember[] = [];
  for (const id of party.memberIds) {
    const member = server.getPlayer(id);
    const info = member === undefined ? null : memberInfo(member, party);
    if (info !== null) members.push(info);
  }
  return members;
}

function sendReply(player: Player, replyCode: PartyReplyCode, playerName?: string): void {
  const reply = new PartyReplyServerPacket();
  reply.replyCode = replyCode;
  if (replyCode === PartyReplyCode.AlreadyInAnotherParty) {
    const data = new PartyReplyServerPacket.ReplyCodeDataAlreadyInAnotherParty();
    data.playerName = playerName ?? '';
    reply.replyCodeData = data;
  } else if (replyCode === PartyReplyCode.AlreadyInYourParty) {
    const data = new PartyReplyServerPacket.ReplyCodeDataAlreadyInYourParty();
    data.playerName = playerName ?? '';
    reply.replyCodeData = data;
  }
  player.bus.send(reply);
}

function partyRequest(player: Player, reader: EoReader): void {
  const packet = PartyRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const requestType = packet.requestType;
  if (requestType !== PartyRequestType.Join && requestType !== PartyRequestType.Invite) return;
  if (packet.playerId === player.id) return;

  const map = player.map!;
  const character = player.character!;
  const targetCharacter = map.characters.get(packet.playerId);
  const target = map.getPlayer(packet.playerId);
  if (targetCharacter === undefined || target === undefined || target === player || !inGame(target)) {
    return;
  }
  if (targetCharacter.row.hidden === 1 || target.captcha !== null) return;
  if (!inClientRange(character.row.x, character.row.y, targetCharacter.row.x, targetCharacter.row.y)) {
    return;
  }

  const parties = player.server.parties;
  const targetParty = parties.partyOf(target.id);
  const ownParty = parties.partyOf(player.id);
  if (targetParty !== undefined) {
    if (targetParty.memberIds.includes(player.id)) {
      return sendReply(player, PartyReplyCode.AlreadyInYourParty, targetCharacter.name);
    }
    if (requestType === PartyRequestType.Invite) {
      return sendReply(player, PartyReplyCode.AlreadyInAnotherParty, targetCharacter.name);
    }
  }
  if (requestType === PartyRequestType.Join && ownParty !== undefined) return;

  const party = requestType === PartyRequestType.Join ? targetParty : ownParty;
  if (party !== undefined && party.memberIds.length >= player.config.limits.maxPartySize) {
    return sendReply(player, PartyReplyCode.PartyIsFull);
  }

  target.partyRequest = { requestType, fromPlayerId: player.id };
  const request = new PartyRequestServerPacket();
  request.requestType = requestType;
  request.inviterPlayerId = player.id;
  request.playerName = character.name;
  target.bus.send(request);
}

function partyAccept(player: Player, reader: EoReader): void {
  const packet = PartyAcceptClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const pending = player.partyRequest;
  if (
    pending === null ||
    pending.requestType !== packet.requestType ||
    pending.fromPlayerId !== packet.inviterPlayerId
  ) {
    return;
  }
  player.partyRequest = null;

  const other = player.server.getPlayer(packet.inviterPlayerId);
  if (other === undefined || other === player || !inGame(other)) return;

  const parties = player.server.parties;
  const invite = packet.requestType === PartyRequestType.Invite;
  const joining = invite ? player : other;
  const anchor = invite ? other : player;

  if (parties.partyOf(joining.id) !== undefined) return;

  const existing = parties.partyOf(anchor.id);
  if (existing === undefined) {
    const party = parties.create(anchor.id, joining.id);
    if (party === null) return;
    const create = new PartyCreateServerPacket();
    create.members = membersList(player.server, party);
    for (const id of party.memberIds) player.server.getPlayer(id)?.bus.send(create);
    return;
  }

  if (existing.memberIds.length >= player.config.limits.maxPartySize) {
    return sendReply(player, PartyReplyCode.PartyIsFull);
  }
  if (!parties.addMember(existing, joining.id)) return;

  const info = memberInfo(joining, existing);
  if (info !== null) {
    const add = new PartyAddServerPacket();
    add.member = info;
    for (const id of existing.memberIds) {
      if (id !== joining.id) player.server.getPlayer(id)?.bus.send(add);
    }
  }
  const create = new PartyCreateServerPacket();
  create.members = membersList(player.server, existing);
  joining.bus.send(create);
}

function partyRemove(player: Player, reader: EoReader): void {
  const packet = PartyRemoveClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const party = player.server.parties.partyOf(player.id);
  if (party === undefined) return;
  if (packet.playerId !== player.id) {
    if (party.leaderId !== player.id || !party.memberIds.includes(packet.playerId)) return;
  }
  leaveParty(player.server, packet.playerId);
}

export function leaveParty(server: Player['server'], playerId: number): void {
  const result = server.parties.removeMember(playerId);
  if (result === null) return;

  server.getPlayer(playerId)?.bus.send(new PartyCloseServerPacket());

  if (result.disbanded) {
    for (const id of result.party.memberIds) {
      server.getPlayer(id)?.bus.send(new PartyCloseServerPacket());
    }
    return;
  }

  const remove = new PartyRemoveServerPacket();
  remove.playerId = playerId;
  for (const id of result.party.memberIds) {
    server.getPlayer(id)?.bus.send(remove);
  }
}

function partyTake(player: Player, reader: EoReader): void {
  PartyTakeClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const party = player.server.parties.partyOf(player.id);
  if (party === undefined) return;
  const list = new PartyListServerPacket();
  list.members = membersList(player.server, party);
  player.bus.send(list);
}

export function handleParty(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      partyRequest(player, reader);
      break;
    case PacketAction.Accept:
      partyAccept(player, reader);
      break;
    case PacketAction.Remove:
      partyRemove(player, reader);
      break;
    case PacketAction.Take:
      partyTake(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Party action');
  }
}
