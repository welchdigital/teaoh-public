import { PacketFamily } from 'eolib';
import type { FamilyHandler } from '../player.ts';
import { handleAccount } from './account.ts';
import { handleAdminInteract } from './admin-interact.ts';
import { handleAttack } from './attack.ts';
import { handleBank } from './bank.ts';
import { handleBarber } from './barber.ts';
import { handleBoard } from './board.ts';
import { handleBook } from './book.ts';
import { handleChair } from './chair.ts';
import { handleCharacter } from './character.ts';
import { handleChest } from './chest.ts';
import { handleCitizen } from './citizen.ts';
import { handleConnection } from './connection.ts';
import { handleDoor } from './door.ts';
import { handleEmote } from './emote.ts';
import { handleFace } from './face.ts';
import { handleGlobal } from './global.ts';
import { handleGuild } from './guild.ts';
import { handleInit } from './init.ts';
import { handleItem } from './item.ts';
import { handleJukebox } from './jukebox.ts';
import { handleLocker } from './locker.ts';
import { handleLogin } from './login.ts';
import { handleMarriage } from './marriage.ts';
import { handleMessage } from './message.ts';
import { handleNpcRange } from './npc-range.ts';
import { handlePaperdoll } from './paperdoll.ts';
import { handlePlayers } from './players.ts';
import { handleParty } from './party.ts';
import { handlePlayerRange, handleRange } from './range.ts';
import { handlePriest } from './priest.ts';
import { handleQuest } from './quest.ts';
import { handleRefresh } from './refresh.ts';
import { handleShop } from './shop.ts';
import { handleSit } from './sit.ts';
import { handleSpell } from './spell.ts';
import { handleStatSkill } from './stat-skill.ts';
import { handleTalk } from './talk.ts';
import { handleTrade } from './trade.ts';
import { handleWalk } from './walk.ts';
import { handleWarp } from './warp.ts';
import { handleWelcome } from './welcome.ts';

export const handlers: ReadonlyMap<number, FamilyHandler> = new Map<number, FamilyHandler>([
  [PacketFamily.Init, handleInit],
  [PacketFamily.Connection, handleConnection],
  [PacketFamily.Account, handleAccount],
  [PacketFamily.Login, handleLogin],
  [PacketFamily.Character, handleCharacter],
  [PacketFamily.Welcome, handleWelcome],
  [PacketFamily.Walk, handleWalk],
  [PacketFamily.Face, handleFace],
  [PacketFamily.Talk, handleTalk],
  [PacketFamily.Sit, handleSit],
  [PacketFamily.Emote, handleEmote],
  [PacketFamily.Refresh, handleRefresh],
  [PacketFamily.Attack, handleAttack],
  [PacketFamily.Warp, handleWarp],
  [PacketFamily.Door, handleDoor],
  [PacketFamily.Item, handleItem],
  [PacketFamily.NpcRange, handleNpcRange],
  [PacketFamily.Paperdoll, handlePaperdoll],
  [PacketFamily.Players, handlePlayers],
  [PacketFamily.Shop, handleShop],
  [PacketFamily.Bank, handleBank],
  [PacketFamily.Locker, handleLocker],
  [PacketFamily.Chest, handleChest],
  [PacketFamily.Party, handleParty],
  [PacketFamily.Trade, handleTrade],
  [PacketFamily.Quest, handleQuest],
  [PacketFamily.StatSkill, handleStatSkill],
  [PacketFamily.Spell, handleSpell],
  [PacketFamily.Board, handleBoard],
  [PacketFamily.Guild, handleGuild],
  [PacketFamily.Jukebox, handleJukebox],
  [PacketFamily.Citizen, handleCitizen],
  [PacketFamily.Marriage, handleMarriage],
  [PacketFamily.Priest, handlePriest],
  [PacketFamily.Chair, handleChair],
  [PacketFamily.Barber, handleBarber],
  [PacketFamily.Book, handleBook],
  [PacketFamily.Range, handleRange],
  [PacketFamily.PlayerRange, handlePlayerRange],
  [PacketFamily.Message, handleMessage],
  [PacketFamily.Global, handleGlobal],
  [PacketFamily.AdminInteract, handleAdminInteract],
]);
