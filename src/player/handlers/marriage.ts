import {
  EoReader,
  MarriageOpenClientPacket,
  MarriageOpenServerPacket,
  MarriageReply,
  MarriageReplyServerPacket,
  MarriageRequestClientPacket,
  MarriageRequestType,
  NpcType,
  PacketAction,
} from 'eolib';
import type { Character } from '../../character/character.ts';
import { MAX_CHARACTER_NAME_COLUMN } from '../../config.ts';
import { log } from '../../log.ts';
import { inClientRange } from '../../world/coords.ts';
import { GOLD_ITEM } from '../../constants.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { findLoadedPlayer, inGame } from './common.ts';
import { isTrading } from './trade.ts';

function atLawyer(player: Player, sessionId: number): boolean {
  if (player.peekSessionId() !== sessionId || player.interactNpcIndex === null) return false;
  const npc = player.map!.npcs.get(player.interactNpcIndex);
  return npc !== undefined && npc.data.type === NpcType.Lawyer;
}

function validName(player: Player, name: string): boolean {
  const { minNameLength, maxNameLength } = player.config.character;
  const max = Math.min(maxNameLength, MAX_CHARACTER_NAME_COLUMN);
  return name.length >= minNameLength && name.length <= max && /^[a-z]+$/.test(name);
}

function sendReply(player: Player, replyCode: MarriageReply): void {
  const reply = new MarriageReplyServerPacket();
  reply.replyCode = replyCode;
  player.bus.send(reply);
}

function sendSuccess(player: Player, character: Character): void {
  const reply = new MarriageReplyServerPacket();
  reply.replyCode = MarriageReply.Success;
  const data = new MarriageReplyServerPacket.ReplyCodeDataSuccess();
  data.goldAmount = character.heldAmount(GOLD_ITEM);
  reply.replyCodeData = data;
  player.bus.send(reply);
}

function marriageOpen(player: Player, reader: EoReader): void {
  const packet = MarriageOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Lawyer) return;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  player.interactNpcIndex = packet.npcIndex;
  const reply = new MarriageOpenServerPacket();
  reply.sessionId = player.generateSessionId();
  player.bus.send(reply);
}

function requestApproval(player: Player, character: Character, name: string): void {
  const cost = player.config.marriage.approvalCost;
  if (character.row.partner !== null) return sendReply(player, MarriageReply.AlreadyMarried);
  if (name === character.name) return sendReply(player, MarriageReply.WrongName);
  if (character.heldAmount(GOLD_ITEM) < cost) return sendReply(player, MarriageReply.NotEnoughGold);
  character.removeItem(GOLD_ITEM, cost);
  character.row.fiance = name;
  sendSuccess(player, character);
}

function divorceLoadedPartner(partner: Player, name: string): void {
  const partnerCharacter = partner.character;
  if (partnerCharacter === null || partnerCharacter.row.partner !== name) return;
  partnerCharacter.row.partner = null;
  if (partner.state !== ClientState.InGame) return;
  const notify = new MarriageReplyServerPacket();
  notify.replyCode = MarriageReply.DivorceNotification;
  partner.bus.send(notify);
}

async function requestDivorce(player: Player, character: Character, name: string): Promise<void> {
  const cost = player.config.marriage.divorceCost;
  if (character.row.partner === null) return sendReply(player, MarriageReply.NotMarried);
  if (character.row.partner !== name) return sendReply(player, MarriageReply.WrongName);
  if (character.heldAmount(GOLD_ITEM) < cost) return sendReply(player, MarriageReply.NotEnoughGold);
  character.removeItem(GOLD_ITEM, cost);
  character.row.partner = null;
  sendSuccess(player, character);

  const partner = findLoadedPlayer(player.server, name);
  if (partner !== undefined) {
    divorceLoadedPartner(partner, character.name);
  } else {
    try {
      await player.server.db
        .updateTable('characters')
        .set({ partner: null })
        .where('name', '=', name)
        .where('partner', '=', character.name)
        .execute();
      const late = findLoadedPlayer(player.server, name);
      if (late !== undefined) divorceLoadedPartner(late, character.name);
    } catch (err) {
      log.error({ player: player.id, err: String(err) }, 'failed to divorce offline partner');
    }
  }
  await character.save(player.server.db).catch((err: unknown) => {
    log.error({ player: player.id, err: String(err) }, 'failed to save divorce');
  });
  log.info({ cat: 'marriage', character: character.name, partner: name }, 'divorced');
}

function marriageRequest(player: Player, reader: EoReader): Promise<void> | void {
  const packet = MarriageRequestClientPacket.deserialize(reader);
  if (!inGame(player) || !atLawyer(player, packet.sessionId)) return;
  if (isTrading(player)) return;
  const character = player.character!;
  const name = packet.name.toLowerCase();
  if (!validName(player, name)) return;

  switch (packet.requestType) {
    case MarriageRequestType.MarriageApproval:
      return requestApproval(player, character, name);
    case MarriageRequestType.Divorce:
      return requestDivorce(player, character, name);
  }
}

export function handleMarriage(
  player: Player,
  action: number,
  reader: EoReader,
): Promise<void> | void {
  switch (action) {
    case PacketAction.Open:
      return marriageOpen(player, reader);
    case PacketAction.Request:
      return marriageRequest(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Marriage action');
  }
}
