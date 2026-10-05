import {
  ChestAddClientPacket,
  ChestOpenClientPacket,
  ChestTakeClientPacket,
  EoReader,
  PacketAction,
} from 'eolib';
import { log } from '../../log.ts';
import { addToChest, openChest, takeFromChest } from '../../world/map/interact/chest.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

export function handleChest(player: Player, action: number, reader: EoReader): void {
  if (!inGame(player)) return;
  switch (action) {
    case PacketAction.Open: {
      const packet = ChestOpenClientPacket.deserialize(reader);
      openChest(player.map!, player, player.character!, packet.coords.x, packet.coords.y);
      break;
    }
    case PacketAction.Add: {
      const packet = ChestAddClientPacket.deserialize(reader);
      if (isTrading(player)) return;
      addToChest(
        player.map!,
        player,
        player.character!,
        packet.coords.x,
        packet.coords.y,
        packet.addItem.id,
        packet.addItem.amount,
      );
      break;
    }
    case PacketAction.Take: {
      const packet = ChestTakeClientPacket.deserialize(reader);
      if (isTrading(player)) return;
      takeFromChest(
        player.map!,
        player,
        player.character!,
        packet.coords.x,
        packet.coords.y,
        packet.takeItemId,
      );
      break;
    }
    default:
      log.debug({ player: player.id, action }, 'unhandled Chest action');
  }
}
