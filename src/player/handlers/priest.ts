import {
  EoReader,
  NpcType,
  PacketAction,
  PriestAcceptClientPacket,
  PriestOpenClientPacket,
  PriestOpenServerPacket,
  PriestReply,
  PriestReplyServerPacket,
  PriestRequestClientPacket,
  PriestRequestServerPacket,
  PriestUseClientPacket,
} from 'eolib';
import { log } from '../../log.ts';
import { inClientRange } from '../../world/coords.ts';
import {
  dressedForWedding,
  startWedding,
  weddingAccepted,
  weddingBusy,
  weddingSayIDo,
} from '../../world/map/interact/wedding.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

const PRIEST_REQUEST_COOLDOWN_MS = 3000;
const lastPriestRequest = new WeakMap<Player, number>();

function requestCoolingDown(player: Player): boolean {
  const now = Date.now();
  const last = lastPriestRequest.get(player);
  if (last !== undefined && now - last < PRIEST_REQUEST_COOLDOWN_MS) return true;
  lastPriestRequest.set(player, now);
  return false;
}

function atPriest(player: Player, sessionId: number): boolean {
  if (player.peekSessionId() !== sessionId || player.interactNpcIndex === null) return false;
  const npc = player.map!.npcs.get(player.interactNpcIndex);
  return npc !== undefined && npc.data.type === NpcType.Priest;
}

function sendReply(player: Player, replyCode: PriestReply): void {
  const reply = new PriestReplyServerPacket();
  reply.replyCode = replyCode;
  player.bus.send(reply);
}

function priestOpen(player: Player, reader: EoReader): void {
  const packet = PriestOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  const map = player.map!;

  const npc = map.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Priest) return;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;
  if (character.row.fiance === null || character.row.partner !== null) return;
  if (weddingBusy(map, player.id)) return sendReply(player, PriestReply.Busy);
  if (character.row.level < player.config.marriage.minLevel) {
    return sendReply(player, PriestReply.LowLevel);
  }
  if (!dressedForWedding(map, character)) return sendReply(player, PriestReply.NotDressed);

  player.interactNpcIndex = packet.npcIndex;
  const reply = new PriestOpenServerPacket();
  reply.sessionId = player.generateSessionId();
  player.bus.send(reply);
}

function priestRequest(player: Player, reader: EoReader): void {
  const packet = PriestRequestClientPacket.deserialize(reader);
  if (!inGame(player) || !atPriest(player, packet.sessionId)) return;
  if (requestCoolingDown(player)) return;
  const character = player.character!;
  const map = player.map!;
  if (character.row.fiance === null || character.row.partner !== null) return;

  const fianceName = packet.name.toLowerCase();
  if (fianceName === character.name) return sendReply(player, PriestReply.NoPermission);
  const fiance = [...map.characters.values()].find((c) => c.name === fianceName);
  const fiancePlayer = fiance === undefined ? undefined : map.getPlayer(fiance.playerId);
  if (fiance === undefined || fiancePlayer === undefined || !inGame(fiancePlayer)) {
    return sendReply(player, PriestReply.PartnerNotPresent);
  }
  if (character.row.fiance !== fianceName) return sendReply(player, PriestReply.NoPermission);
  if (fiance.row.partner !== null) return sendReply(player, PriestReply.PartnerAlreadyMarried);
  if (fiance.row.fiance !== character.name) return sendReply(player, PriestReply.NoPermission);
  if (!dressedForWedding(map, fiance)) return sendReply(player, PriestReply.PartnerNotDressed);

  const wedding = startWedding(map, player.id, fiance.playerId, player.interactNpcIndex!);
  if (wedding === null) return sendReply(player, PriestReply.Busy);

  const request = new PriestRequestServerPacket();
  request.sessionId = wedding.sessionId;
  request.partnerName = character.name;
  fiancePlayer.bus.send(request);
}

function priestAccept(player: Player, reader: EoReader): void {
  const packet = PriestAcceptClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  weddingAccepted(player.map!, player.id, packet.sessionId);
}

function priestUse(player: Player, reader: EoReader): void {
  const packet = PriestUseClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const map = player.map!;
  if (packet.sessionId !== player.peekSessionId() && packet.sessionId !== map.wedding?.sessionId) return;
  weddingSayIDo(map, player.id);
}

export function handlePriest(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Open:
      priestOpen(player, reader);
      break;
    case PacketAction.Request:
      priestRequest(player, reader);
      break;
    case PacketAction.Accept:
      priestAccept(player, reader);
      break;
    case PacketAction.Use:
      priestUse(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Priest action');
  }
}
