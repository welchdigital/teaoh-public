import { Direction, EoReader, FacePlayerClientPacket, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { face } from '../../world/map/character/face.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function facePlayer(player: Player, reader: EoReader): void {
  const packet = FacePlayerClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.character === null || player.map === null) {
    return;
  }
  if (packet.direction < Direction.Down || packet.direction > Direction.Right) return;
  face(player.map, player.character, packet.direction);
}

export function handleFace(player: Player, action: number, reader: EoReader): void {
  if (player.captcha != null) return;
  switch (action) {
    case PacketAction.Player:
      facePlayer(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Face action');
  }
}
