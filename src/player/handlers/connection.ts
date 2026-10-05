import { ConnectionAcceptClientPacket, EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function connectionAccept(player: Player, reader: EoReader): void {
  const accept = ConnectionAcceptClientPacket.deserialize(reader);

  if (player.state !== ClientState.Initialized) {
    player.close('connection accept out of sequence');
    return;
  }

  if (accept.playerId !== player.id) {
    player.close(`invalid connection id: got ${accept.playerId}, expected ${player.id}`);
    return;
  }

  if (
    accept.clientEncryptionMultiple !== player.bus.clientEncryptionMultiple ||
    accept.serverEncryptionMultiple !== player.bus.serverEncryptionMultiple
  ) {
    player.close(
      `invalid encryption multiples: got server ${accept.serverEncryptionMultiple}, ` +
        `client ${accept.clientEncryptionMultiple}`,
    );
    return;
  }

  player.state = ClientState.Accepted;
}

export function handleConnection(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Accept:
      connectionAccept(player, reader);
      break;
    case PacketAction.Ping:
      player.bus.needPong = false;
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Connection action');
  }
}
