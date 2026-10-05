import { BookReplyServerPacket, BookRequestClientPacket, EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';
import { characterDetails, inGame } from './common.ts';
import { iconFor } from './players.ts';

function bookRequest(player: Player, reader: EoReader): void {
  const packet = BookRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const target = player.map!.characters.get(packet.playerId);
  if (target === undefined) return;
  if (target.row.hidden === 1 && target.playerId !== player.id) return;

  const reply = new BookReplyServerPacket();
  reply.details = characterDetails(target);
  reply.icon = iconFor(target, player.server.parties.partyOf(target.playerId) !== undefined);
  reply.questNames = [];
  for (const progress of target.quests.values()) {
    if (progress.doneAt === null || progress.state === 0) continue;
    const quest = player.server.quests.get(progress.questId);
    if (quest !== undefined && quest.visibility === 'visible') reply.questNames.push(quest.name);
  }
  player.bus.send(reply);
}

export function handleBook(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Request:
      bookRequest(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Book action');
  }
}
