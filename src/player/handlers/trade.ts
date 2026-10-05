import {
  Emote,
  EmotePlayerServerPacket,
  EoReader,
  Item,
  ItemSpecial,
  PacketAction,
  TradeAcceptClientPacket,
  TradeAddClientPacket,
  TradeAdminServerPacket,
  TradeAgreeClientPacket,
  TradeAgreeServerPacket,
  TradeCloseServerPacket,
  TradeItemData,
  TradeOpenServerPacket,
  TradeRemoveClientPacket,
  TradeReplyServerPacket,
  TradeRequestClientPacket,
  TradeRequestServerPacket,
  TradeSpecServerPacket,
  TradeUseServerPacket,
} from 'eolib';
import type { Character } from '../../character/character.ts';
import { inClientRange } from '../../world/coords.ts';
import { isProtectedItem } from '../../world/item-rules.ts';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

const MAX_TRADE_SLOTS = 10;

export function isTrading(player: Player): boolean {
  return (player.trade ?? null) !== null;
}

function partnerOf(player: Player): Player | null {
  if (player.trade === null) return null;
  const partner = player.server.getPlayer(player.trade.partnerId);
  if (partner === undefined || partner === player || partner.trade?.partnerId !== player.id) return null;
  return partner;
}

function inRangeOf(a: Player, b: Player): boolean {
  const ca = a.character;
  const cb = b.character;
  if (ca === null || cb === null || a.map === null || a.map !== b.map) return false;
  return inClientRange(ca.row.x, ca.row.y, cb.row.x, cb.row.y);
}

function offerData(player: Player, items: Item[]): TradeItemData {
  const data = new TradeItemData();
  data.playerId = player.id;
  data.items = items;
  return data;
}

function offerChanged(changed: Player, partner: Player): void {
  const changedHadAgreed = changed.trade?.agreed ?? false;
  const partnerHadAgreed = partner.trade?.agreed ?? false;
  if (changed.trade !== null) changed.trade.agreed = false;
  if (partner.trade !== null) partner.trade.agreed = false;

  const changedOffer = offerData(changed, changed.trade?.items ?? []);
  const partnerOffer = offerData(partner, partner.trade?.items ?? []);
  const reply = new TradeReplyServerPacket();
  reply.tradeData = [partnerOffer, changedOffer];
  changed.bus.send(reply);
  if (partnerHadAgreed) {
    const admin = new TradeAdminServerPacket();
    admin.tradeData = [changedOffer, partnerOffer];
    partner.bus.send(admin);
  } else {
    const update = new TradeReplyServerPacket();
    update.tradeData = [changedOffer, partnerOffer];
    partner.bus.send(update);
  }
  if (changedHadAgreed) sendAgreement(changed, partner, false);
}

export function cancelTrade(player: Player, notifyPartner: boolean): void {
  const partner = partnerOf(player);
  player.trade = null;
  player.tradeRequestTo = null;
  if (partner === null) return;
  partner.trade = null;
  if (notifyPartner) {
    const close = new TradeCloseServerPacket();
    close.partnerPlayerId = player.id;
    partner.bus.send(close);
  }
}

export function closeTrade(player: Player): void {
  const partner = partnerOf(player);
  cancelTrade(player, true);
  if (partner === null) return;
  const close = new TradeCloseServerPacket();
  close.partnerPlayerId = partner.id;
  player.bus.send(close);
}

function tradeRequest(player: Player, reader: EoReader): void {
  const packet = TradeRequestClientPacket.deserialize(reader);
  if (!inGame(player) || isTrading(player) || (player.captcha ?? null) !== null) return;
  if (player.map!.id === player.config.world.jailMap) return;
  if (packet.playerId === player.id) return;

  const target = player.map!.getPlayer(packet.playerId);
  if (
    target === undefined ||
    target === player ||
    target.character === null ||
    target.character.row.hidden === 1 ||
    (target.captcha ?? null) !== null ||
    isTrading(target) ||
    !inRangeOf(player, target)
  ) {
    return;
  }

  player.tradeRequestTo = target.id;
  const request = new TradeRequestServerPacket();
  request.partnerPlayerId = player.id;
  request.partnerPlayerName = player.character!.name;
  target.bus.send(request);
}

function tradeAccept(player: Player, reader: EoReader): void {
  const packet = TradeAcceptClientPacket.deserialize(reader);
  if (!inGame(player) || isTrading(player)) return;
  if (packet.playerId === player.id) return;

  const partner = player.map!.getPlayer(packet.playerId);
  if (
    partner === undefined ||
    partner === player ||
    partner.character === null ||
    (partner.tradeRequestTo ?? null) !== player.id ||
    isTrading(partner) ||
    !inRangeOf(player, partner)
  ) {
    return;
  }
  partner.tradeRequestTo = null;
  player.tradeRequestTo = null;

  player.trade = { partnerId: partner.id, items: [], agreed: false };
  partner.trade = { partnerId: player.id, items: [], agreed: false };

  for (const [self, other] of [
    [player, partner],
    [partner, player],
  ] as const) {
    const open = new TradeOpenServerPacket();
    open.partnerPlayerId = other.id;
    open.partnerPlayerName = other.character!.name;
    open.yourPlayerId = self.id;
    open.yourPlayerName = self.character!.name;
    self.bus.send(open);
  }
}

function tradeAdd(player: Player, reader: EoReader): void {
  const packet = TradeAddClientPacket.deserialize(reader);
  const partner = partnerOf(player);
  if (!inGame(player) || player.trade === null || partner === null) return;
  const { id, amount } = packet.addItem;
  if (amount <= 0 || amount > player.config.limits.maxTrade) return;
  if (isProtectedItem(player.config, id)) return;
  const record = player.server.pubData.eif?.parsed.items[id - 1];
  if (record === undefined || record.special === ItemSpecial.Lore) return;
  if (player.character!.heldAmount(id) < amount) return;

  const offered = player.trade.items.find((i) => i.id === id);
  if (offered !== undefined) {
    offered.amount = amount;
  } else {
    if (player.trade.items.length >= MAX_TRADE_SLOTS) return;
    const item = new Item();
    item.id = id;
    item.amount = amount;
    player.trade.items.push(item);
  }
  offerChanged(player, partner);
}

function tradeRemove(player: Player, reader: EoReader): void {
  const packet = TradeRemoveClientPacket.deserialize(reader);
  const partner = partnerOf(player);
  if (!inGame(player) || player.trade === null || partner === null) return;

  const before = player.trade.items.length;
  player.trade.items = player.trade.items.filter((i) => i.id !== packet.itemId);
  if (player.trade.items.length === before) return;
  offerChanged(player, partner);
}

function sendAgreement(player: Player, partner: Player, agree: boolean): void {
  const spec = new TradeSpecServerPacket();
  spec.agree = agree;
  player.bus.send(spec);
  const notice = new TradeAgreeServerPacket();
  notice.partnerPlayerId = player.id;
  notice.agree = agree;
  partner.bus.send(notice);
}

function holdsOffer(player: Player): boolean {
  const character = player.character;
  if (character === null || player.trade === null) return false;
  return player.trade.items.every((item) => item.amount > 0 && character.heldAmount(item.id) >= item.amount);
}

function tradeEmote(player: Player): void {
  const character = player.character;
  if (character === null || player.map === null || character.row.hidden === 1) return;
  const emote = new EmotePlayerServerPacket();
  emote.playerId = player.id;
  emote.emote = Emote.Trade;
  player.map.broadcastNear(emote, character.row.x, character.row.y);
}

function completeTrade(player: Player, partner: Player): void {
  if (
    partner === player ||
    player.trade === null ||
    partner.trade === null ||
    player.map === null ||
    player.map !== partner.map ||
    !holdsOffer(player) ||
    !holdsOffer(partner)
  ) {
    log.warn(
      { cat: 'trade', player: player.id, partner: partner.id },
      'trade aborted: offers no longer valid',
    );
    closeTrade(player);
    return;
  }

  const maxItem = player.config.limits.maxItem;
  const a = player.character!;
  const b = partner.character!;
  const offerA = player.trade.items;
  const offerB = partner.trade.items;
  player.trade = null;
  partner.trade = null;

  const take = (from: Character, offer: Item[]): Item[] =>
    offer.map((item) => {
      const taken = new Item();
      taken.id = item.id;
      taken.amount = from.removeItem(item.id, item.amount);
      return taken;
    });
  const takenA = take(a, offerA);
  const takenB = take(b, offerB);

  const deliver = (from: Character, to: Character, offer: Item[]): Item[] =>
    offer.map((item) => {
      const received = to.canHoldAmount(item.id, item.amount, maxItem);
      if (received > 0) to.addItem(item.id, received);
      if (received < item.amount) from.addItem(item.id, item.amount - received);
      const moved = new Item();
      moved.id = item.id;
      moved.amount = received;
      return moved;
    });
  const givenA = deliver(a, b, takenA).filter((item) => item.amount > 0);
  const givenB = deliver(b, a, takenB).filter((item) => item.amount > 0);

  const fromPlayer = offerData(player, givenA);
  const fromPartner = offerData(partner, givenB);
  const playerUse = new TradeUseServerPacket();
  playerUse.tradeData = [fromPartner, fromPlayer];
  player.bus.send(playerUse);
  const partnerUse = new TradeUseServerPacket();
  partnerUse.tradeData = [fromPlayer, fromPartner];
  partner.bus.send(partnerUse);
  log.info(
    {
      cat: 'trade',
      a: a.name,
      b: b.name,
      aGave: givenA.map((i) => [i.id, i.amount]),
      bGave: givenB.map((i) => [i.id, i.amount]),
    },
    'trade completed',
  );
  tradeEmote(player);
  tradeEmote(partner);
}

function tradeAgree(player: Player, reader: EoReader): void {
  const packet = TradeAgreeClientPacket.deserialize(reader);
  const partner = partnerOf(player);
  if (!inGame(player) || player.trade === null || partner === null) return;

  if (!packet.agree) {
    player.trade.agreed = false;
    sendAgreement(player, partner, false);
    return;
  }
  if (player.trade.items.length === 0 || partner.trade!.items.length === 0) return;
  player.trade.agreed = true;
  if (partner.trade!.agreed) {
    completeTrade(player, partner);
    return;
  }
  sendAgreement(player, partner, true);
}

function tradeClose(player: Player): void {
  if (player.trade === null) {
    player.tradeRequestTo = null;
    return;
  }
  cancelTrade(player, true);
}

export function handleTrade(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      tradeRequest(player, reader);
      break;
    case PacketAction.Accept:
      tradeAccept(player, reader);
      break;
    case PacketAction.Add:
      tradeAdd(player, reader);
      break;
    case PacketAction.Remove:
      tradeRemove(player, reader);
      break;
    case PacketAction.Agree:
      tradeAgree(player, reader);
      break;
    case PacketAction.Close:
      tradeClose(player);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Trade action');
  }
}
