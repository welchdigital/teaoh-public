import {
  CharItem,
  EoReader,
  Item,
  NpcType,
  PacketAction,
  ShopBuyClientPacket,
  ShopBuyServerPacket,
  ShopCraftItem,
  ShopCreateClientPacket,
  ShopCreateServerPacket,
  ShopOpenClientPacket,
  ShopOpenServerPacket,
  ShopSellClientPacket,
  ShopSellServerPacket,
  ShopSoldItem,
  ShopTradeItem,
} from 'eolib';
import { inClientRange } from '../../world/coords.ts';
import { log } from '../../log.ts';
import { GOLD_ITEM } from '../../constants.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

function openShop(player: Player) {
  if (player.openShopId === null || player.interactNpcIndex === null || player.map === null) {
    return undefined;
  }
  const npc = player.map.npcs.get(player.interactNpcIndex);
  if (npc === undefined || npc.data.type !== NpcType.Shop || npc.data.behaviorId !== player.openShopId) {
    return undefined;
  }
  return player.server.pubData.shopForBehaviorId(player.openShopId);
}

function shopOpen(player: Player, reader: EoReader): void {
  const packet = ShopOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.generateSessionId();

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Shop) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  const shop = player.server.pubData.shopForBehaviorId(npc.data.behaviorId);
  if (shop === undefined) return;

  player.openShopId = shop.behaviorId;
  player.interactNpcIndex = packet.npcIndex;
  const reply = new ShopOpenServerPacket();
  reply.sessionId = sessionId;
  reply.shopName = shop.name;
  reply.tradeItems = shop.trades.map((trade) => {
    const item = new ShopTradeItem();
    item.itemId = trade.itemId;
    item.buyPrice = trade.buyPrice;
    item.sellPrice = trade.sellPrice;
    item.maxBuyAmount = trade.maxAmount;
    return item;
  });
  reply.craftItems = shop.crafts.map((craft) => {
    const item = new ShopCraftItem();
    item.itemId = craft.itemId;
    item.ingredients = craft.ingredients.map((ingredient) => {
      const charItem = new CharItem();
      charItem.id = ingredient.itemId;
      charItem.amount = ingredient.amount;
      return charItem;
    });
    return item;
  });
  player.bus.send(reply);
}

function shopBuy(player: Player, reader: EoReader): void {
  const packet = ShopBuyClientPacket.deserialize(reader);
  if (!inGame(player) || player.openShopId === null) return;
  if (player.peekSessionId() !== packet.sessionId) return;
  const maxItem = player.config.limits.maxItem;
  if (packet.buyItem.amount <= 0 || packet.buyItem.amount > maxItem) return;

  const trade = openShop(player)?.trades.find(
    (t) => t.itemId === packet.buyItem.id && t.buyPrice > 0,
  );
  if (trade === undefined) return;

  const character = player.character!;
  const fits = character.canHold(player.server.pubData, trade.itemId, packet.buyItem.amount, maxItem);
  const amount = Math.min(fits, trade.maxAmount);
  if (amount <= 0) return;
  const cost = trade.buyPrice * amount;
  if (character.heldAmount(GOLD_ITEM) < cost) return;

  character.removeItem(GOLD_ITEM, cost);
  character.addItem(trade.itemId, amount);

  const reply = new ShopBuyServerPacket();
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  const bought = new Item();
  bought.id = trade.itemId;
  bought.amount = amount;
  reply.boughtItem = bought;
  reply.weight = character.weight(player.server.pubData);
  player.bus.send(reply);
}

function shopSell(player: Player, reader: EoReader): void {
  const packet = ShopSellClientPacket.deserialize(reader);
  if (!inGame(player) || player.openShopId === null) return;
  if (player.peekSessionId() !== packet.sessionId) return;
  const maxItem = player.config.limits.maxItem;
  if (packet.sellItem.amount <= 0 || packet.sellItem.amount > maxItem) return;

  const trade = openShop(player)?.trades.find(
    (t) => t.itemId === packet.sellItem.id && t.sellPrice > 0,
  );
  if (trade === undefined) return;

  const character = player.character!;
  const goldRoom = character.canHoldAmount(GOLD_ITEM, maxItem, maxItem);
  const amount = Math.min(
    packet.sellItem.amount,
    character.heldAmount(trade.itemId),
    trade.maxAmount,
    Math.floor(goldRoom / trade.sellPrice),
  );
  if (amount <= 0) return;

  const sold = character.removeItem(trade.itemId, amount);
  if (sold <= 0) return;
  character.addItem(GOLD_ITEM, trade.sellPrice * sold);

  const reply = new ShopSellServerPacket();
  const soldItem = new ShopSoldItem();
  soldItem.id = trade.itemId;
  soldItem.amount = character.heldAmount(trade.itemId);
  reply.soldItem = soldItem;
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  reply.weight = character.weight(player.server.pubData);
  player.bus.send(reply);
}

function shopCraft(player: Player, reader: EoReader): void {
  const packet = ShopCreateClientPacket.deserialize(reader);
  if (!inGame(player) || player.openShopId === null) return;
  if (player.peekSessionId() !== packet.sessionId) return;

  const craft = openShop(player)?.crafts.find((c) => c.itemId === packet.craftItemId);
  if (craft === undefined) return;

  const character = player.character!;
  if (character.canHoldAmount(craft.itemId, 1, player.config.limits.maxItem) < 1) return;
  for (const ingredient of craft.ingredients) {
    if (ingredient.itemId <= 0) continue;
    if (character.heldAmount(ingredient.itemId) < ingredient.amount) return;
  }

  for (const ingredient of craft.ingredients) {
    if (ingredient.itemId <= 0) continue;
    character.removeItem(ingredient.itemId, ingredient.amount);
  }
  character.addItem(craft.itemId, 1);

  const reply = new ShopCreateServerPacket();
  reply.craftItemId = craft.itemId;
  reply.weight = character.weight(player.server.pubData);
  reply.ingredients = craft.ingredients.map((ingredient) => {
    const item = new Item();
    item.id = ingredient.itemId;
    item.amount = character.heldAmount(ingredient.itemId);
    return item;
  });
  player.bus.send(reply);
}

export function handleShop(player: Player, action: number, reader: EoReader): void {
  if (isTrading(player)) return;
  switch (action) {
    case PacketAction.Open:
      shopOpen(player, reader);
      break;
    case PacketAction.Buy:
      shopBuy(player, reader);
      break;
    case PacketAction.Sell:
      shopSell(player, reader);
      break;
    case PacketAction.Create:
      shopCraft(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Shop action');
  }
}
