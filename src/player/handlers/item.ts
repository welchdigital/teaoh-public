import {
  EoReader,
  ItemDropClientPacket,
  ItemGetClientPacket,
  ItemJunkClientPacket,
  ItemUseClientPacket,
  PacketAction,
} from 'eolib';
import { log } from '../../log.ts';
import { ItemReportClientPacket } from '../../world/map/character/item-packets.ts';
import { dropItem, getItem, junkItem } from '../../world/map/character/items.ts';
import { useItem, useTitleItem } from '../../world/map/character/use-item.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

function itemGet(player: Player, reader: EoReader): void {
  const packet = ItemGetClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  getItem(player.map!, player, player.character!, packet.itemIndex);
}

function itemDrop(player: Player, reader: EoReader): void {
  const packet = ItemDropClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  const atFeet = packet.coords.x === 255 && packet.coords.y === 255;
  const x = atFeet ? character.row.x : packet.coords.x - 1;
  const y = atFeet ? character.row.y : packet.coords.y - 1;
  dropItem(player.map!, player, character, packet.item.id, packet.item.amount, x, y);
}

function itemJunk(player: Player, reader: EoReader): void {
  const packet = ItemJunkClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  junkItem(player.map!, player, player.character!, packet.item.id, packet.item.amount);
}

function itemUse(player: Player, reader: EoReader): void {
  const packet = ItemUseClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  useItem(player.map!, player, player.character!, packet.itemId);
}

function itemReport(player: Player, reader: EoReader): void {
  const packet = ItemReportClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  useTitleItem(player.map!, player, player.character!, packet.itemId, packet.title);
}

export function handleItem(player: Player, action: number, reader: EoReader): void {
  if (player.trade != null) return;
  switch (action) {
    case PacketAction.Get:
      itemGet(player, reader);
      break;
    case PacketAction.Drop:
      itemDrop(player, reader);
      break;
    case PacketAction.Junk:
      itemJunk(player, reader);
      break;
    case PacketAction.Use:
      itemUse(player, reader);
      break;
    case PacketAction.Report:
      itemReport(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Item action');
  }
}
