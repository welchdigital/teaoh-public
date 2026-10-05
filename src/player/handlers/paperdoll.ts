import {
  AdminLevel,
  CharacterIcon,
  EoReader,
  PacketAction,
  PaperdollAddClientPacket,
  PaperdollRemoveClientPacket,
  PaperdollReplyServerPacket,
  PaperdollRequestClientPacket,
} from 'eolib';
import type { Character } from '../../character/character.ts';
import { log } from '../../log.ts';
import { equip, unequip } from '../../world/map/character/equip.ts';
import type { Player } from '../player.ts';
import { characterDetails, inGame } from './common.ts';

export function paperdollIcon(character: Character, inParty: boolean): CharacterIcon {
  switch (character.row.admin_level) {
    case AdminLevel.Guardian:
    case AdminLevel.GameMaster:
      return inParty ? CharacterIcon.GmParty : CharacterIcon.Gm;
    case AdminLevel.HighGameMaster:
      return inParty ? CharacterIcon.HgmParty : CharacterIcon.Hgm;
    default:
      return inParty ? CharacterIcon.Party : CharacterIcon.Player;
  }
}

function paperdollAdd(player: Player, reader: EoReader): void {
  const packet = PaperdollAddClientPacket.deserialize(reader);
  if (!inGame(player) || player.trade != null) return;
  equip(player.map!, player, player.character!, packet.itemId, packet.subLoc);
}

function paperdollRemove(player: Player, reader: EoReader): void {
  const packet = PaperdollRemoveClientPacket.deserialize(reader);
  if (!inGame(player) || player.trade != null) return;
  unequip(player.map!, player, player.character!, packet.itemId, packet.subLoc);
}

function paperdollRequest(player: Player, reader: EoReader): void {
  const packet = PaperdollRequestClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const target = player.map!.characters.get(packet.playerId);
  if (target === undefined) return;
  if (target.row.hidden === 1 && target.playerId !== player.id) return;

  const reply = new PaperdollReplyServerPacket();
  reply.details = characterDetails(target);
  reply.equipment = target.equipmentPaperdoll();
  reply.icon = paperdollIcon(target, player.server.parties.partyOf(target.playerId) !== undefined);
  player.bus.send(reply);
}

export function handlePaperdoll(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Add:
      paperdollAdd(player, reader);
      break;
    case PacketAction.Remove:
      paperdollRemove(player, reader);
      break;
    case PacketAction.Request:
      paperdollRequest(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Paperdoll action');
  }
}
