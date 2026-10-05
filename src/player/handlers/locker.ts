import {
  CHAR_MAX,
  EoReader,
  LockerAddClientPacket,
  LockerBuyServerPacket,
  LockerOpenClientPacket,
  LockerTakeClientPacket,
  PacketAction,
} from 'eolib';
import { log } from '../../log.ts';
import { addToLocker, openLocker, takeFromLocker } from '../../world/map/interact/locker.ts';
import { GOLD_ITEM } from '../../constants.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { bankNpcOpen } from './bank.ts';
import { isTrading } from './trade.ts';

function lockerBuy(player: Player): void {
  if (!bankNpcOpen(player)) return;
  const character = player.character!;
  const { maxUpgrades, upgradeBaseCost, upgradeCostStep } = player.config.bank;
  if (character.row.bank_level >= maxUpgrades) return;

  const cost = upgradeBaseCost + character.row.bank_level * upgradeCostStep;
  if (character.heldAmount(GOLD_ITEM) < cost) return;

  character.removeItem(GOLD_ITEM, cost);
  character.row.bank_level++;

  const reply = new LockerBuyServerPacket();
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  reply.lockerUpgrades = Math.min(character.row.bank_level, CHAR_MAX - 1);
  player.bus.send(reply);
}

export function handleLocker(player: Player, action: number, reader: EoReader): void {
  if (!inGame(player) || isTrading(player)) return;
  switch (action) {
    case PacketAction.Buy:
      lockerBuy(player);
      return;
    case PacketAction.Open: {
      const packet = LockerOpenClientPacket.deserialize(reader);
      openLocker(
        player.map!,
        player,
        player.character!,
        packet.lockerCoords.x,
        packet.lockerCoords.y,
      );
      break;
    }
    case PacketAction.Add: {
      const packet = LockerAddClientPacket.deserialize(reader);
      addToLocker(
        player.map!,
        player,
        player.character!,
        packet.lockerCoords.x,
        packet.lockerCoords.y,
        packet.depositItem.id,
        packet.depositItem.amount,
      );
      break;
    }
    case PacketAction.Take: {
      const packet = LockerTakeClientPacket.deserialize(reader);
      takeFromLocker(
        player.map!,
        player,
        player.character!,
        packet.lockerCoords.x,
        packet.lockerCoords.y,
        packet.takeItemId,
      );
      break;
    }
    default:
      log.debug({ player: player.id, action }, 'unhandled Locker action');
  }
}
