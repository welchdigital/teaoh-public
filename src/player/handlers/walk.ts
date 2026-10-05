import { Direction, EoReader, PacketAction, WalkPlayerClientPacket } from 'eolib';
import { log } from '../../log.ts';
import { walk } from '../../world/map/character/walk.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { timestampDiff } from '../timestamp.ts';

const MIN_WALK_INTERVAL = 36;

interface StepBudget {
  tokens: number;
  at: number;
}

const budgets = new WeakMap<Player, StepBudget>();

export function takeStep(player: Player, now = Date.now()): boolean {
  const { walkInterval, walkBurst } = player.config.world;
  if (walkInterval <= 0) return true;
  let budget = budgets.get(player);
  if (budget === undefined) {
    budget = { tokens: walkBurst, at: now };
    budgets.set(player, budget);
  }
  budget.tokens = Math.min(walkBurst, budget.tokens + Math.max(0, now - budget.at) / walkInterval);
  budget.at = now;
  if (budget.tokens < 1) return false;
  budget.tokens -= 1;
  return true;
}

function walkPlayer(player: Player, reader: EoReader): void {
  const packet = WalkPlayerClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame || player.character === null || player.map === null) {
    return;
  }
  if (player.captcha != null || player.frozen || player.isDying === true) return;

  const action = packet.walkAction;
  const elapsed = timestampDiff(action.timestamp, player.timestamp);
  if (elapsed < 0) {
    player.timestamp = action.timestamp;
    return;
  }
  if (elapsed < MIN_WALK_INTERVAL || !takeStep(player)) return;
  player.timestamp = action.timestamp;

  if (action.direction < Direction.Down || action.direction > Direction.Right) return;
  walk(player.map, player, player.character, action.direction, {
    x: action.coords.x,
    y: action.coords.y,
  });
}

export function handleWalk(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Player:
    case PacketAction.Admin:
    case PacketAction.Spec:
      walkPlayer(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Walk action');
  }
}
