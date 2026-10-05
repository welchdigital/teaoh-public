import {
  EoReader,
  PacketAction,
  PlayerRangeRequestClientPacket,
  PlayersAgreeServerPacket,
  RangeReplyServerPacket,
  RangeRequestClientPacket,
} from 'eolib';
import { log } from '../../log.ts';
import { sendBossPings } from '../../world/map/character/refresh.ts';
import { getInfoByIds, npcsByIndexes } from '../../world/map/visibility.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

export function handleRange(player: Player, action: number, reader: EoReader): void {
  if (action !== PacketAction.Request) {
    log.debug({ player: player.id, action }, 'unhandled Range action');
    return;
  }
  const packet = RangeRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const map = player.map!;
  const character = player.character!;
  const npcs = npcsByIndexes(map, character, packet.npcIndexes);
  const reply = new RangeReplyServerPacket();
  reply.nearby = getInfoByIds(map, character, packet.playerIds, npcs);
  player.bus.send(reply);
  sendBossPings(player, npcs);
}

export function handlePlayerRange(player: Player, action: number, reader: EoReader): void {
  if (action !== PacketAction.Request) {
    log.debug({ player: player.id, action }, 'unhandled PlayerRange action');
    return;
  }
  const packet = PlayerRangeRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const reply = new PlayersAgreeServerPacket();
  reply.nearby = getInfoByIds(player.map!, player.character!, packet.playerIds, []);
  player.bus.send(reply);
}
