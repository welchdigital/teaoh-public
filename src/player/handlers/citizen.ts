import {
  CHAR_MAX,
  CitizenAcceptClientPacket,
  CitizenAcceptServerPacket,
  CitizenOpenClientPacket,
  CitizenOpenServerPacket,
  CitizenReplyClientPacket,
  CitizenReplyServerPacket,
  CitizenRemoveServerPacket,
  CitizenRequestClientPacket,
  CitizenRequestServerPacket,
  EoReader,
  InnUnsubscribeReply,
  NpcType,
  PacketAction,
} from 'eolib';
import type { InnRecord } from 'eolib';
import { inClientRange } from '../../world/coords.ts';
import { broadcastPartyHp } from '../../world/map/party-hp.ts';
import { log } from '../../log.ts';
import { GOLD_ITEM } from '../../constants.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

function defaultHome(player: Player): string {
  return player.config.newCharacter.home;
}

function innForBehavior(player: Player, behaviorId: number): InnRecord | undefined {
  return player.server.pubData.inns?.inns.find((inn) => inn.behaviorId === behaviorId);
}

function innForName(player: Player, name: string): InnRecord | undefined {
  return player.server.pubData.inns?.inns.find((inn) => inn.name === name);
}

function openInnkeeper(player: Player): InnRecord | undefined {
  if (player.interactNpcIndex === null) return undefined;
  const npc = player.map!.npcs.get(player.interactNpcIndex);
  if (npc === undefined || npc.data.type !== NpcType.Inn) return undefined;
  return innForBehavior(player, npc.data.behaviorId);
}

function citizenOpen(player: Player, reader: EoReader): void {
  const packet = CitizenOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.generateSessionId();

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Inn) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;
  const inn = innForBehavior(player, npc.data.behaviorId);
  if (inn === undefined) return;

  const currentInn = innForName(player, character.row.home ?? defaultHome(player));
  player.interactNpcIndex = packet.npcIndex;
  const reply = new CitizenOpenServerPacket();
  reply.behaviorId = inn.behaviorId + 1;
  reply.currentHomeId = Math.min(Math.max(0, (currentInn?.behaviorId ?? 1) - 1), CHAR_MAX - 1);
  reply.sessionId = sessionId;
  reply.questions = [
    inn.questions[0]?.question ?? '',
    inn.questions[1]?.question ?? '',
    inn.questions[2]?.question ?? '',
  ];
  player.bus.send(reply);
}

function citizenReply(player: Player, reader: EoReader): void {
  const packet = CitizenReplyClientPacket.deserialize(reader);
  if (!inGame(player) || player.peekSessionId() !== packet.sessionId) return;
  const inn = openInnkeeper(player);
  if (inn === undefined) return;

  let wrong = 0;
  for (let i = 0; i < 3; i++) {
    const expected = inn.questions[i]?.answer ?? '';
    if ((packet.answers[i] ?? '').toLowerCase() !== expected.toLowerCase()) wrong++;
  }
  if (wrong === 0) player.character!.row.home = inn.name;

  const reply = new CitizenReplyServerPacket();
  reply.questionsWrong = wrong;
  player.bus.send(reply);
}

function citizenRemove(player: Player): void {
  if (!inGame(player)) return;
  const inn = openInnkeeper(player);
  if (inn === undefined) return;
  const character = player.character!;
  const home = character.row.home ?? defaultHome(player);
  const reply = new CitizenRemoveServerPacket();
  if (home === defaultHome(player) || home !== inn.name) {
    reply.replyCode = InnUnsubscribeReply.NotCitizen;
  } else {
    character.row.home = defaultHome(player);
    reply.replyCode = InnUnsubscribeReply.Unsubscribed;
  }
  player.bus.send(reply);
}

function citizenRequest(player: Player, reader: EoReader): void {
  const packet = CitizenRequestClientPacket.deserialize(reader);
  if (!inGame(player) || player.peekSessionId() !== packet.sessionId) return;
  const inn = openInnkeeper(player);
  const character = player.character!;
  if (inn === undefined || inn.name !== character.row.home) return;
  const hp = Math.min(character.row.hp, character.maxHp);
  const tp = Math.min(character.row.tp, character.maxTp);
  if (hp >= character.maxHp && tp >= character.maxTp) return;

  const cost = character.maxHp - hp + (character.maxTp - tp);
  player.sleepCost = cost;
  const reply = new CitizenRequestServerPacket();
  reply.cost = cost;
  player.bus.send(reply);
}

function citizenAccept(player: Player, reader: EoReader): void {
  const packet = CitizenAcceptClientPacket.deserialize(reader);
  if (!inGame(player) || player.peekSessionId() !== packet.sessionId) return;
  const inn = openInnkeeper(player);
  const character = player.character!;
  if (inn === undefined || inn.name !== character.row.home) return;
  const cost = player.sleepCost;
  if (cost <= 0 || character.heldAmount(GOLD_ITEM) < cost) return;

  character.removeItem(GOLD_ITEM, cost);
  character.row.hp = character.maxHp;
  character.row.tp = character.maxTp;
  player.sleepCost = 0;

  const reply = new CitizenAcceptServerPacket();
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  player.bus.send(reply);
  broadcastPartyHp(player.map!, character);
  player.requestWarp(
    inn.sleepMap,
    inn.sleepX,
    inn.sleepY,
    inn.sleepMap === character.mapId,
  );
}

export function handleCitizen(player: Player, action: number, reader: EoReader): void {
  if (isTrading(player)) return;
  switch (action) {
    case PacketAction.Open:
      citizenOpen(player, reader);
      break;
    case PacketAction.Reply:
      citizenReply(player, reader);
      break;
    case PacketAction.Remove:
      citizenRemove(player);
      break;
    case PacketAction.Request:
      citizenRequest(player, reader);
      break;
    case PacketAction.Accept:
      citizenAccept(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Citizen action');
  }
}
