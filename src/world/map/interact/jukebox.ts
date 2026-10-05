import {
  JukeboxAgreeServerPacket,
  JukeboxMsgServerPacket,
  JukeboxOpenServerPacket,
  JukeboxReplyServerPacket,
  JukeboxUseServerPacket,
  SkillType,
} from 'eolib';
import type { Character } from '../../../character/character.ts';
import { GOLD_ITEM } from '../../../constants.ts';
import type { Player } from '../../../player/player.ts';
import { inClientRange } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';

function nearJukebox(map: GameMap, character: Character): boolean {
  return map.tiles.jukeboxes.some((tile) =>
    inClientRange(character.row.x, character.row.y, tile.x, tile.y),
  );
}

export function openJukebox(map: GameMap, player: Player, character: Character): void {
  if (!nearJukebox(map, character)) return;
  const reply = new JukeboxOpenServerPacket();
  reply.mapId = map.id;
  reply.jukeboxPlayer = map.jukeboxTicks > 0 ? (map.jukeboxPlayerName ?? 'Busy') : '';
  player.bus.send(reply);
}

export function playJukeboxTrack(map: GameMap, player: Player, character: Character, trackId: number): void {
  const config = player.config.jukebox;
  if (!nearJukebox(map, character)) return;
  if (
    map.jukeboxTicks > 0 ||
    character.heldAmount(GOLD_ITEM) < config.cost ||
    trackId < 1 ||
    trackId > config.maxTrackId
  ) {
    player.bus.send(new JukeboxReplyServerPacket());
    return;
  }

  character.removeItem(GOLD_ITEM, config.cost);
  map.jukeboxPlayerName = character.name;
  map.jukeboxTicks = config.trackTimer;

  const agree = new JukeboxAgreeServerPacket();
  agree.goldAmount = character.heldAmount(GOLD_ITEM);
  player.bus.send(agree);

  const use = new JukeboxUseServerPacket();
  use.trackId = trackId;
  map.broadcast(use);
}

export function playInstrument(
  map: GameMap,
  player: Player,
  character: Character,
  instrumentId: number,
  noteId: number,
): void {
  const config = player.config.jukebox;
  if (instrumentId <= 0 || noteId <= 0 || noteId > config.maxNoteId) return;
  if (character.row.weapon === 0 || !config.instrumentItems.includes(instrumentId)) return;

  const weapon = map.deps.pubData.eif?.parsed.items[character.row.weapon - 1];
  if (weapon === undefined || weapon.spec1 !== instrumentId) return;
  const knowsBardSpell = character.spells.some(
    (s) => map.deps.pubData.esf?.parsed.skills[s.id - 1]?.type === SkillType.Bard,
  );
  if (!knowsBardSpell) return;

  const packet = new JukeboxMsgServerPacket();
  packet.playerId = character.playerId;
  packet.direction = character.direction;
  packet.instrumentId = instrumentId;
  packet.noteId = noteId;
  map.broadcastNear(packet, character.row.x, character.row.y, character.playerId);
}

export function jukeboxTimer(map: GameMap): void {
  if (map.tiles.jukeboxes.length === 0) return;
  if (map.jukeboxTicks <= 0) {
    map.jukeboxTicks = 0;
    map.jukeboxPlayerName = null;
    return;
  }
  map.jukeboxTicks--;
}
