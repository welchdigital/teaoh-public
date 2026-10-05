import {
  EffectPlayerServerPacket,
  Gender,
  JukeboxPlayerServerPacket,
  NpcDialogServerPacket,
  PlayerEffect,
  PriestReply,
  PriestReplyServerPacket,
  SHORT_MAX,
  TalkPlayerServerPacket,
} from 'eolib';
import { randomInt } from 'node:crypto';
import type { Character } from '../../../character/character.ts';
import { lang } from '../../../lang.ts';
import { log } from '../../../log.ts';
import { inClientRange } from '../../coords.ts';
import { giveItem } from '../character/items.ts';
import type { GameMap } from '../game-map.ts';

export const WeddingState = {
  Requested: 0,
  Accepted: 1,
  PriestDialog1: 2,
  PriestDialog2: 3,
  PriestDoYouPartner: 4,
  AskPartner: 5,
  WaitingForPartner: 6,
  PartnerAgrees: 7,
  PriestDoYouPlayer: 8,
  AskPlayer: 9,
  WaitingForPlayer: 10,
  PlayerAgrees: 11,
  PriestDialog3: 12,
  PriestDialog4: 13,
  Hearts: 14,
  PriestDialog5AndConfetti: 15,
  Done: 16,
} as const;

export type WeddingState = (typeof WeddingState)[keyof typeof WeddingState];

export interface Wedding {
  playerId: number;
  partnerId: number;
  npcIndex: number;
  state: WeddingState;
  ticks: number;
  sessionId: number;
}

export const WEDDING_REQUEST_TIMEOUT_SECONDS = 60;
export const WEDDING_ANSWER_SECONDS = 20;
export const CONFETTI_EFFECT_ID = 11;

function displayName(character: Character): string {
  return character.name.charAt(0).toUpperCase() + character.name.slice(1);
}

export function dressedForWedding(map: GameMap, character: Character): boolean {
  const config = map.deps.config.marriage;
  switch (character.row.gender) {
    case Gender.Female:
      return character.row.armor === config.femaleArmorId;
    case Gender.Male:
      return character.row.armor === config.maleArmorId;
    default:
      return false;
  }
}

function pendingRequest(map: GameMap, wedding: Wedding): boolean {
  return (
    wedding.state === WeddingState.Requested &&
    wedding.ticks < WEDDING_REQUEST_TIMEOUT_SECONDS &&
    map.characters.has(wedding.playerId) &&
    map.characters.has(wedding.partnerId)
  );
}

function inCouple(wedding: Wedding, playerId: number): boolean {
  return wedding.playerId === playerId || wedding.partnerId === playerId;
}

export function weddingBusy(map: GameMap, playerId?: number, partnerId?: number): boolean {
  const wedding = map.wedding;
  if (wedding === null || wedding.state === WeddingState.Done) return false;
  if (wedding.state !== WeddingState.Requested) return true;
  if (!pendingRequest(map, wedding)) return false;
  if (playerId === undefined || !inCouple(wedding, playerId)) return true;
  return partnerId !== undefined && !inCouple(wedding, partnerId);
}

export function startWedding(
  map: GameMap,
  playerId: number,
  partnerId: number,
  npcIndex: number,
): Wedding | null {
  if (playerId === partnerId || weddingBusy(map, playerId, partnerId)) return null;
  const previous = map.wedding;
  const renewal = previous !== null && pendingRequest(map, previous);
  const wedding: Wedding = {
    playerId,
    partnerId,
    npcIndex,
    state: WeddingState.Requested,
    ticks: renewal ? previous.ticks : 0,
    sessionId: renewal && previous.partnerId === partnerId ? previous.sessionId : randomInt(1, SHORT_MAX),
  };
  map.wedding = wedding;
  return wedding;
}

export function weddingAccepted(map: GameMap, playerId: number, sessionId: number): void {
  const wedding = map.wedding;
  if (wedding === null || wedding.sessionId !== sessionId) return;
  if (wedding.partnerId === playerId && wedding.state === WeddingState.Requested) {
    wedding.state = WeddingState.Accepted;
    wedding.ticks = 0;
  }
}

export function weddingSayIDo(map: GameMap, playerId: number): void {
  const wedding = map.wedding;
  if (wedding === null) return;
  if (wedding.partnerId === playerId && wedding.state === WeddingState.WaitingForPartner) {
    wedding.state = WeddingState.PartnerAgrees;
    wedding.ticks = 0;
  } else if (wedding.playerId === playerId && wedding.state === WeddingState.WaitingForPlayer) {
    wedding.state = WeddingState.PlayerAgrees;
    wedding.ticks = 0;
  }
}

function waitSeconds(map: GameMap, state: WeddingState): number {
  switch (state) {
    case WeddingState.Accepted:
    case WeddingState.PartnerAgrees:
    case WeddingState.PlayerAgrees:
      return 0;
    case WeddingState.PriestDialog5AndConfetti:
      return 2;
    case WeddingState.PriestDialog1:
      return map.deps.config.marriage.ceremonyStartDelaySeconds;
    case WeddingState.AskPartner:
    case WeddingState.AskPlayer:
    case WeddingState.PriestDialog3:
      return 3;
    case WeddingState.WaitingForPartner:
    case WeddingState.WaitingForPlayer:
      return WEDDING_ANSWER_SECONDS;
    default:
      return 9;
  }
}

function npcChat(map: GameMap, npcIndex: number, message: string): void {
  const npc = map.npcs.get(npcIndex);
  if (npc === undefined) return;
  const packet = new NpcDialogServerPacket();
  packet.npcIndex = npcIndex;
  packet.message = message;
  map.broadcastNear(packet, npc.x, npc.y);
}

function playerChat(map: GameMap, character: Character, message: string): void {
  const packet = new TalkPlayerServerPacket();
  packet.playerId = character.playerId;
  packet.message = message;
  map.broadcastNear(packet, character.row.x, character.row.y);
}

function effectOnPlayers(map: GameMap, targets: Character[], effectId: number): void {
  const packet = new EffectPlayerServerPacket();
  packet.effects = targets.map((target) => {
    const effect = new PlayerEffect();
    effect.playerId = target.playerId;
    effect.effectId = effectId;
    return effect;
  });
  for (const [playerId, player] of map.players) {
    const observer = map.characters.get(playerId);
    if (observer === undefined) continue;
    const sees = targets.some(
      (target) =>
        target.row.hidden !== 1 &&
        inClientRange(observer.row.x, observer.row.y, target.row.x, target.row.y),
    );
    if (sees) player.bus.send(packet);
  }
}

function abortWedding(map: GameMap, npcIndex: number): void {
  npcChat(map, npcIndex, lang('wedding_error'));
  map.wedding = null;
}

function marry(map: GameMap, character: Character, partner: Character): void {
  const ringId = map.deps.config.marriage.ringItemId;
  for (const [spouse, other] of [
    [character, partner],
    [partner, character],
  ] as const) {
    const player = map.players.get(spouse.playerId);
    if (player !== undefined && ringId > 0) giveItem(map, player, spouse, ringId, 1);
    spouse.setPartner(other.name);
    if (player !== undefined) {
      spouse.save(player.server.db).catch((err: unknown) => {
        log.error({ character: spouse.name, err: String(err) }, 'failed to save marriage');
      });
    }
  }
  log.info({ cat: 'marriage', character: character.name, partner: partner.name }, 'married');
}

export function timedWedding(map: GameMap): void {
  const wedding = map.wedding;
  if (wedding === null) return;
  const { npcIndex, playerId, partnerId, state } = wedding;

  if (state === WeddingState.Requested) {
    wedding.ticks++;
    if (
      wedding.ticks >= WEDDING_REQUEST_TIMEOUT_SECONDS ||
      !map.characters.has(playerId) ||
      !map.characters.has(partnerId)
    ) {
      map.wedding = null;
    }
    return;
  }

  wedding.ticks++;
  if (wedding.ticks < waitSeconds(map, state)) return;

  const character = map.characters.get(playerId);
  const partner = map.characters.get(partnerId);
  if (character === undefined || partner === undefined) {
    abortWedding(map, npcIndex);
    return;
  }
  const name = displayName(character);
  const partnerName = displayName(partner);

  let next: WeddingState;
  switch (state) {
    case WeddingState.Accepted: {
      const config = map.deps.config.marriage;
      npcChat(map, npcIndex, lang('wedding_start', { delay: config.ceremonyStartDelaySeconds }));
      if (config.mfxId > 0) {
        const music = new JukeboxPlayerServerPacket();
        music.mfxId = config.mfxId;
        map.broadcast(music);
      }
      next = WeddingState.PriestDialog1;
      break;
    }
    case WeddingState.PriestDialog1:
      npcChat(map, npcIndex, lang('wedding_one', { partner: partnerName, name }));
      next = WeddingState.PriestDialog2;
      break;
    case WeddingState.PriestDialog2:
      npcChat(map, npcIndex, lang('wedding_two', { partner: partnerName, name }));
      next = WeddingState.PriestDoYouPartner;
      break;
    case WeddingState.PriestDoYouPartner:
      npcChat(map, npcIndex, lang('wedding_do_you', { partner: partnerName, name }));
      next = WeddingState.AskPartner;
      break;
    case WeddingState.AskPartner: {
      const reply = new PriestReplyServerPacket();
      reply.replyCode = PriestReply.DoYou;
      map.players.get(partnerId)?.bus.send(reply);
      next = WeddingState.WaitingForPartner;
      break;
    }
    case WeddingState.WaitingForPartner:
    case WeddingState.WaitingForPlayer:
      abortWedding(map, npcIndex);
      return;
    case WeddingState.PartnerAgrees:
      playerChat(map, partner, lang('wedding_i_do'));
      next = WeddingState.PriestDoYouPlayer;
      break;
    case WeddingState.PriestDoYouPlayer:
      npcChat(map, npcIndex, lang('wedding_do_you', { partner: name, name: partnerName }));
      next = WeddingState.AskPlayer;
      break;
    case WeddingState.AskPlayer: {
      const reply = new PriestReplyServerPacket();
      reply.replyCode = PriestReply.DoYou;
      map.players.get(playerId)?.bus.send(reply);
      next = WeddingState.WaitingForPlayer;
      break;
    }
    case WeddingState.PlayerAgrees:
      playerChat(map, character, lang('wedding_i_do'));
      next = WeddingState.PriestDialog3;
      break;
    case WeddingState.PriestDialog3:
      npcChat(map, npcIndex, lang('wedding_three'));
      marry(map, character, partner);
      next = WeddingState.PriestDialog4;
      break;
    case WeddingState.PriestDialog4:
      npcChat(map, npcIndex, lang('wedding_four'));
      next = WeddingState.Hearts;
      break;
    case WeddingState.Hearts: {
      const effectId = map.deps.config.marriage.celebrationEffectId;
      if (effectId > 0) effectOnPlayers(map, [character, partner], effectId);
      next = WeddingState.PriestDialog5AndConfetti;
      break;
    }
    case WeddingState.PriestDialog5AndConfetti:
      npcChat(map, npcIndex, lang('wedding_five', { partner: partnerName, name }));
      effectOnPlayers(map, [character, partner], CONFETTI_EFFECT_ID);
      next = WeddingState.Done;
      break;
    case WeddingState.Done:
      npcChat(map, npcIndex, lang('wedding_end'));
      map.wedding = null;
      return;
    default:
      return;
  }

  wedding.state = next;
  wedding.ticks = 0;
}
