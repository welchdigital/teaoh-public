import {
  BankAddClientPacket,
  BankOpenClientPacket,
  BankOpenServerPacket,
  BankReplyServerPacket,
  BankTakeClientPacket,
  CHAR_MAX,
  EoReader,
  INT_MAX,
  NpcType,
  PacketAction,
} from 'eolib';
import { inClientRange } from '../../world/coords.ts';
import { log } from '../../log.ts';
import { GOLD_ITEM } from '../../constants.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

function wireGold(amount: number): number {
  return Math.min(Math.max(0, amount), INT_MAX - 1);
}

export function bankNpcOpen(player: Player): boolean {
  if (!player.bankOpen || player.interactNpcIndex === null || player.map === null) return false;
  const npc = player.map.npcs.get(player.interactNpcIndex);
  return npc !== undefined && npc.data.type === NpcType.Bank;
}

function bankOpen(player: Player, reader: EoReader): void {
  const packet = BankOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.generateSessionId();

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Bank) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  player.bankOpen = true;
  player.interactNpcIndex = packet.npcIndex;
  const reply = new BankOpenServerPacket();
  reply.goldBank = wireGold(character.row.gold_bank);
  reply.sessionId = sessionId;
  reply.lockerUpgrades = Math.min(character.row.bank_level, CHAR_MAX - 1);
  player.bus.send(reply);
}

function sendBankReply(player: Player): void {
  const character = player.character!;
  const reply = new BankReplyServerPacket();
  reply.goldInventory = character.heldAmount(GOLD_ITEM);
  reply.goldBank = wireGold(character.row.gold_bank);
  player.bus.send(reply);
}

function bankAdd(player: Player, reader: EoReader): void {
  const packet = BankAddClientPacket.deserialize(reader);
  if (!inGame(player) || !bankNpcOpen(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;

  const character = player.character!;
  const amount = Math.min(
    packet.amount,
    character.heldAmount(GOLD_ITEM),
    player.config.limits.maxBankGold - character.row.gold_bank,
  );
  if (amount <= 0) return;

  const removed = character.removeItem(GOLD_ITEM, amount);
  if (removed <= 0) return;
  character.row.gold_bank += removed;
  sendBankReply(player);
}

function bankTake(player: Player, reader: EoReader): void {
  const packet = BankTakeClientPacket.deserialize(reader);
  if (!inGame(player) || !bankNpcOpen(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;

  const character = player.character!;
  const requested = Math.min(packet.amount, character.row.gold_bank);
  if (requested <= 0) return;
  const amount = character.canHold(
    player.server.pubData,
    GOLD_ITEM,
    requested,
    player.config.limits.maxItem,
  );
  if (amount <= 0) return;

  character.row.gold_bank -= amount;
  character.addItem(GOLD_ITEM, amount);
  sendBankReply(player);
}

export function handleBank(player: Player, action: number, reader: EoReader): void {
  if (isTrading(player)) return;
  switch (action) {
    case PacketAction.Open:
      bankOpen(player, reader);
      break;
    case PacketAction.Add:
      bankAdd(player, reader);
      break;
    case PacketAction.Take:
      bankTake(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Bank action');
  }
}
