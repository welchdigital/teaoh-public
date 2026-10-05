import {
  EoReader,
  JukeboxMsgClientPacket,
  JukeboxUseClientPacket,
  PacketAction,
} from 'eolib';
import { log } from '../../log.ts';
import { openJukebox, playInstrument, playJukeboxTrack } from '../../world/map/interact/jukebox.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

export function handleJukebox(player: Player, action: number, reader: EoReader): void {
  if (!inGame(player)) return;
  switch (action) {
    case PacketAction.Open:
      openJukebox(player.map!, player, player.character!);
      break;
    case PacketAction.Msg: {
      const packet = JukeboxMsgClientPacket.deserialize(reader);
      if (isTrading(player)) return;
      playJukeboxTrack(player.map!, player, player.character!, packet.trackId + 1);
      break;
    }
    case PacketAction.Use: {
      const packet = JukeboxUseClientPacket.deserialize(reader);
      playInstrument(player.map!, player, player.character!, packet.instrumentId, packet.noteId);
      break;
    }
    default:
      log.debug({ player: player.id, action }, 'unhandled Jukebox action');
  }
}
