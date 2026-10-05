import {
  AvatarAgreeServerPacket,
  AvatarChange,
  AvatarChangeType,
  BarberAgreeServerPacket,
  BarberBuyClientPacket,
  BarberOpenClientPacket,
  BarberOpenServerPacket,
  EoReader,
  EoWriter,
  NpcType,
  PacketAction,
  SHORT_MAX,
} from 'eolib';
import { inClientRange } from '../../world/coords.ts';
import { log } from '../../log.ts';
import { GOLD_ITEM } from '../../constants.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

export class DeepBarberOpenServerPacket extends BarberOpenServerPacket {
  maxHairStyle = 0;
  baseCost = 0;
  costPerLevel = 0;

  override serialize(writer: EoWriter): void {
    super.serialize(writer);
    writer.addShort(Math.min(Math.max(0, this.maxHairStyle), SHORT_MAX - 1));
    writer.addShort(Math.min(Math.max(0, this.baseCost), SHORT_MAX - 1));
    writer.addShort(Math.min(Math.max(0, this.costPerLevel), SHORT_MAX - 1));
  }
}

function barberOpen(player: Player, reader: EoReader): void {
  const packet = BarberOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.generateSessionId();

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Barber) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  player.interactNpcIndex = packet.npcIndex;
  if (player.isDeep) {
    const reply = new DeepBarberOpenServerPacket();
    reply.sessionId = sessionId;
    reply.maxHairStyle = player.config.character.maxHairStyle;
    reply.baseCost = player.config.barber.baseCost;
    reply.costPerLevel = player.config.barber.costPerLevel;
    player.bus.send(reply);
    return;
  }
  const reply = new BarberOpenServerPacket();
  reply.sessionId = sessionId;
  player.bus.send(reply);
}

function barberBuy(player: Player, reader: EoReader): void {
  const packet = BarberBuyClientPacket.deserialize(reader);
  if (!inGame(player) || player.peekSessionId() !== packet.sessionId) return;
  if (player.interactNpcIndex === null) return;
  const npc = player.map!.npcs.get(player.interactNpcIndex);
  if (npc === undefined || npc.data.type !== NpcType.Barber) return;

  const character = player.character!;
  const { maxHairStyle, maxHairColor } = player.config.character;
  if (
    packet.hairStyle < 0 ||
    packet.hairStyle > maxHairStyle ||
    packet.hairColor < 0 ||
    packet.hairColor > maxHairColor
  ) {
    return;
  }

  const cost =
    player.config.barber.baseCost + Math.max(1, character.row.level) * player.config.barber.costPerLevel;
  if (character.heldAmount(GOLD_ITEM) < cost) return;

  character.removeItem(GOLD_ITEM, cost);
  character.row.hair_style = packet.hairStyle;
  character.row.hair_color = packet.hairColor;

  const change = new AvatarChange();
  change.playerId = player.id;
  change.changeType = AvatarChangeType.Hair;
  change.sound = false;
  const hair = new AvatarChange.ChangeTypeDataHair();
  hair.hairStyle = packet.hairStyle;
  hair.hairColor = packet.hairColor;
  change.changeTypeData = hair;

  const reply = new BarberAgreeServerPacket();
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  reply.change = change;
  player.bus.send(reply);

  if (character.row.hidden !== 1) {
    const broadcast = new AvatarAgreeServerPacket();
    broadcast.change = change;
    player.map!.broadcastNear(broadcast, character.row.x, character.row.y, player.id);
  }
}

export function handleBarber(player: Player, action: number, reader: EoReader): void {
  if (isTrading(player)) return;
  switch (action) {
    case PacketAction.Open:
      barberOpen(player, reader);
      break;
    case PacketAction.Buy:
      barberBuy(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Barber action');
  }
}
