import { AttackUseClientPacket, Direction, EoReader, PacketAction } from 'eolib';
import { log } from '../../log.ts';
import { attack } from '../../world/map/character/attack.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { timestampDiff } from '../timestamp.ts';

export const MIN_ATTACK_INTERVAL = 48;

function attackUse(player: Player, reader: EoReader): void {
  const packet = AttackUseClientPacket.deserialize(reader);
  if (
    player.state !== ClientState.InGame ||
    player.character === null ||
    player.map === null ||
    player.isDying ||
    player.captcha !== null
  ) {
    return;
  }

  if (timestampDiff(packet.timestamp, player.timestamp) < MIN_ATTACK_INTERVAL) return;
  player.timestamp = packet.timestamp;

  if (packet.direction < Direction.Down || packet.direction > Direction.Right) return;
  attack(player.map, player, player.character, packet.direction);
}

export function handleAttack(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Use:
      attackUse(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Attack action');
  }
}
