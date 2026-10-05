import {
  EoReader,
  GuildAcceptClientPacket,
  GuildAcceptServerPacket,
  GuildAgreeClientPacket,
  GuildAgreeServerPacket,
  GuildBuyClientPacket,
  GuildBuyServerPacket,
  GuildCreateClientPacket,
  GuildCreateServerPacket,
  GuildInfoType,
  GuildJunkClientPacket,
  GuildKickClientPacket,
  GuildKickServerPacket,
  GuildMember,
  GuildOpenClientPacket,
  GuildOpenServerPacket,
  GuildPlayerClientPacket,
  GuildRankClientPacket,
  GuildRankServerPacket,
  GuildRemoveClientPacket,
  GuildReply,
  GuildReplyServerPacket,
  GuildReportClientPacket,
  GuildReportServerPacket,
  GuildRequestClientPacket,
  GuildRequestServerPacket,
  GuildSellServerPacket,
  GuildStaff,
  GuildTakeClientPacket,
  GuildTakeServerPacket,
  GuildTellClientPacket,
  GuildTellServerPacket,
  GuildUseClientPacket,
  NpcType,
  PacketAction,
} from 'eolib';
import { sendTalkServer } from '../../admin/actions.ts';
import type { Character } from '../../character/character.ts';
import { GOLD_ITEM } from '../../constants.ts';
import { toUtcDate } from '../../db/schema.ts';
import { lang } from '../../lang.ts';
import { log } from '../../log.ts';
import { inClientRange } from '../../world/coords.ts';
import {
  LEADER_RANK,
  NEW_MEMBER_RANK,
  RANK_COUNT,
  clearMemberGuild,
  countGuildLeaders,
  createGuild,
  deleteGuild,
  depositGuildBank,
  ensureGuildLeader,
  getGuildById,
  getGuildByIdentity,
  getGuildMemberByName,
  getGuildMembers,
  getGuildRanks,
  guildAnnounce,
  guildExists,
  isUniqueViolation,
  loadedGuildMembers,
  setMemberRank,
  updateGuildDescription,
  updateGuildRanks,
  withdrawGuildBank,
  type GuildMemberRow,
} from '../../world/guilds.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { capitalize, findLoadedPlayer, findOnlinePlayer, inGame } from './common.ts';
import { isTrading } from './trade.ts';

interface PendingCreation {
  tag: string;
  name: string;
}

interface PendingJoin {
  guildId: number;
  recruiterId: number;
}

const pendingCreations = new WeakMap<Player, PendingCreation>();
const pendingJoins = new WeakMap<Player, PendingJoin>();

class GuildBankRejected extends Error {}

function atGuildMaster(player: Player, sessionId: number): boolean {
  if (player.peekSessionId() !== sessionId) return false;
  if (player.interactNpcIndex === null) return false;
  const npc = player.map!.npcs.get(player.interactNpcIndex);
  return npc !== undefined && npc.data.type === NpcType.Guild;
}

function sendReply(
  player: Player,
  replyCode: GuildReply,
  data?: GuildReplyServerPacket['replyCodeData'],
): void {
  const reply = new GuildReplyServerPacket();
  reply.replyCode = replyCode;
  if (data !== undefined) reply.replyCodeData = data;
  player.bus.send(reply);
}

function validTag(player: Player, tag: string): boolean {
  const { minTagLength, maxTagLength } = player.config.guild;
  return tag.length >= minTagLength && tag.length <= maxTagLength && /^[A-Za-z]+$/.test(tag);
}

function validName(player: Player, name: string): boolean {
  return (
    name.trim().length > 0 &&
    name.length <= player.config.guild.maxNameLength &&
    /^[A-Za-z0-9 ]+$/.test(name)
  );
}

function validRankName(player: Player, rank: string): boolean {
  return rank.length <= player.config.guild.maxRankLength && /^[A-Za-z ]*$/.test(rank);
}

function validDescription(player: Player, description: string): boolean {
  return (
    description.length <= player.config.guild.maxDescriptionLength &&
    /^[A-Za-z0-9 @\-_.]*$/.test(description)
  );
}

function announce(player: Player, guildId: number, message: string): void {
  if (player.config.guild.announce) guildAnnounce(player.server, guildId, message);
}

function stillMember(player: Player, character: Character, guildId: number): boolean {
  return inGame(player) && player.character === character && character.row.guild_id === guildId;
}

function loadedMember(player: Player, name: string, characterId: number, guildId: number): Player | undefined {
  const member = findLoadedPlayer(player.server, name);
  const memberCharacter = member?.character;
  if (memberCharacter == null || memberCharacter.id !== characterId) return undefined;
  return memberCharacter.row.guild_id === guildId ? member : undefined;
}

function kickLoadedMember(member: Player, memberCharacter: Character): void {
  memberCharacter.setGuild(null, null, null, null, null);
  if (member.state === ClientState.InGame) member.bus.send(new GuildKickServerPacket());
}

function rankLoadedMember(member: Player, memberCharacter: Character, rank: number, rankString: string): void {
  memberCharacter.row.guild_rank = rank;
  memberCharacter.row.guild_rank_string = rankString;
  if (member.state !== ClientState.InGame) return;
  const accept = new GuildAcceptServerPacket();
  accept.rank = rank;
  member.bus.send(accept);
}

function isLeader(character: Character): boolean {
  return character.row.guild_id !== null && character.row.guild_rank === LEADER_RANK;
}

function wealthLabel(bank: number): string {
  if (bank < 2000) return 'bankrupt';
  if (bank < 10_000) return 'poor';
  if (bank < 50_000) return 'normal';
  if (bank < 100_000) return 'wealthy';
  return 'very wealthy';
}

function guildOpen(player: Player, reader: EoReader): void {
  const packet = GuildOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Guild) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  player.interactNpcIndex = packet.npcIndex;
  const reply = new GuildOpenServerPacket();
  reply.sessionId = player.generateSessionId();
  player.bus.send(reply);
}

async function guildRequest(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildRequestClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;
  const config = player.config.guild;

  player.guildCreateMembers = [];
  pendingCreations.delete(player);

  if (!validTag(player, packet.guildTag) || !validName(player, packet.guildName)) {
    return sendReply(player, GuildReply.NotApproved);
  }
  if (character.row.guild_id !== null) return;
  if (character.heldAmount(GOLD_ITEM) < config.createCost) return;
  const tag = packet.guildTag.toUpperCase();
  if (await guildExists(player.server.db, tag, packet.guildName)) {
    return sendReply(player, GuildReply.Exists);
  }
  if (!inGame(player) || player.character !== character || character.row.guild_id !== null) return;

  pendingCreations.set(player, { tag, name: packet.guildName });

  if (config.minPlayers <= 1) {
    const data = new GuildReplyServerPacket.ReplyCodeDataCreateAddConfirm();
    data.name = character.name;
    return sendReply(player, GuildReply.CreateAddConfirm, data);
  }

  const map = player.map!;
  let candidates = 0;
  for (const other of map.characters.values()) {
    if (other.row.guild_id === null) candidates++;
  }
  if (candidates < config.minPlayers) return sendReply(player, GuildReply.NoCandidates);

  sendReply(player, GuildReply.CreateBegin);
  const request = new GuildRequestServerPacket();
  request.playerId = player.id;
  request.guildIdentity = `${capitalize(character.name)} (${tag})`;
  for (const other of map.characters.values()) {
    if (other.playerId !== player.id && other.row.guild_id === null) {
      map.getPlayer(other.playerId)?.bus.send(request);
    }
  }
}

function guildAccept(player: Player, reader: EoReader): void {
  const packet = GuildAcceptClientPacket.deserialize(reader);
  if (!inGame(player) || player.character!.row.guild_id !== null) return;

  const leader = player.server.getPlayer(packet.inviterPlayerId);
  if (leader === undefined || leader === player || !inGame(leader)) return;
  if (leader.character!.row.guild_id !== null || leader.map !== player.map) return;
  if (!pendingCreations.has(leader)) return;
  if (leader.guildCreateMembers.includes(player.id)) return;

  leader.guildCreateMembers.push(player.id);
  if (leader.guildCreateMembers.length + 1 >= player.config.guild.minPlayers) {
    const data = new GuildReplyServerPacket.ReplyCodeDataCreateAddConfirm();
    data.name = player.character!.name;
    sendReply(leader, GuildReply.CreateAddConfirm, data);
  } else {
    const data = new GuildReplyServerPacket.ReplyCodeDataCreateAdd();
    data.name = player.character!.name;
    sendReply(leader, GuildReply.CreateAdd, data);
  }
}

async function guildCreate(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildCreateClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;
  const map = player.map!;
  const config = player.config.guild;

  if (player.guildCreateMembers.length + 1 < config.minPlayers) return;
  const founderIds = [...player.guildCreateMembers];
  const pending = pendingCreations.get(player);
  player.guildCreateMembers = [];
  pendingCreations.delete(player);

  if (
    !validTag(player, packet.guildTag) ||
    !validName(player, packet.guildName) ||
    !validDescription(player, packet.description)
  ) {
    return sendReply(player, GuildReply.NotApproved);
  }
  const tag = packet.guildTag.toUpperCase();
  const name = packet.guildName;
  if (pending !== undefined && (pending.tag !== tag || pending.name !== name)) return;
  if (character.row.guild_id !== null) return;
  if (character.heldAmount(GOLD_ITEM) < config.createCost) return;

  character.removeItem(GOLD_ITEM, config.createCost);
  let guildId = 0;
  try {
    await character.save(player.server.db, async (trx) => {
      guildId = await createGuild(trx, tag, name, packet.description, {
        leader: config.defaultLeaderRankName,
        recruiter: config.defaultRecruiterRankName,
        newMember: config.defaultNewMemberRankName,
      });
      character.setGuild(guildId, tag, name, LEADER_RANK, config.defaultLeaderRankName);
    });
  } catch (err) {
    character.addItem(GOLD_ITEM, config.createCost);
    if (guildId !== 0 && character.row.guild_id === guildId) {
      character.setGuild(null, null, null, null, null);
    }
    if (isUniqueViolation(err)) return sendReply(player, GuildReply.Exists);
    log.error({ player: player.id, err: String(err) }, 'guild creation failed');
    return;
  }

  const created = new GuildCreateServerPacket();
  created.leaderPlayerId = player.id;
  created.guildTag = tag;
  created.guildName = name;
  created.rankName = config.defaultLeaderRankName;
  created.goldAmount = character.heldAmount(GOLD_ITEM);
  player.bus.send(created);

  const founders: Character[] = [];
  for (const founderId of founderIds) {
    const founder = player.server.getPlayer(founderId);
    if (founder === undefined || !inGame(founder) || founder.map !== map) continue;
    const founderCharacter = founder.character!;
    if (founderCharacter.row.guild_id !== null) continue;
    founderCharacter.setGuild(guildId, tag, name, NEW_MEMBER_RANK, config.defaultNewMemberRankName);
    founders.push(founderCharacter);
    const agree = new GuildAgreeServerPacket();
    agree.recruiterId = player.id;
    agree.guildTag = tag;
    agree.guildName = name;
    agree.rankName = config.defaultNewMemberRankName;
    founder.bus.send(agree);
  }
  await Promise.all(
    founders.map((founder) =>
      founder.save(player.server.db).catch((err: unknown) => {
        log.error({ character: founder.name, err: String(err) }, 'failed to save guild founder');
      }),
    ),
  );
  log.info({ guild: tag, leader: character.name, founders: founders.length }, 'guild created');
}

function guildPlayer(player: Player, reader: EoReader): void {
  const packet = GuildPlayerClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;

  if (character.row.guild_id !== null) return sendReply(player, GuildReply.AlreadyMember);
  const recruiter = findOnlinePlayer(player.server, packet.recruiterName);
  if (recruiter === undefined || !inGame(recruiter)) {
    return sendReply(player, GuildReply.RecruiterOffline);
  }
  if (recruiter.map !== player.map) return sendReply(player, GuildReply.RecruiterNotHere);
  const recruiterCharacter = recruiter.character!;
  const guildId = recruiterCharacter.row.guild_id;
  if (
    guildId === null ||
    recruiterCharacter.guildTag === null ||
    recruiterCharacter.guildTag !== packet.guildTag.toUpperCase()
  ) {
    return sendReply(player, GuildReply.RecruiterWrongGuild);
  }
  if ((recruiterCharacter.row.guild_rank ?? NEW_MEMBER_RANK) > player.config.guild.recruitRank) {
    return sendReply(player, GuildReply.NotRecruiter);
  }

  recruiter.interactPlayerId = player.id;
  pendingJoins.set(player, { guildId, recruiterId: recruiter.id });
  const data = new GuildReplyServerPacket.ReplyCodeDataJoinRequest();
  data.playerId = player.id;
  data.name = capitalize(character.name);
  sendReply(recruiter, GuildReply.JoinRequest, data);
}

function joinerReady(recruiter: Player, member: Player, memberCharacter: Character): boolean {
  if (!inGame(member) || member.character !== memberCharacter) return false;
  return memberCharacter.row.guild_id === null && member.map === recruiter.map;
}

async function guildUse(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildUseClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  if (player.interactPlayerId !== packet.playerId) return;
  player.interactPlayerId = null;

  const recruiterCharacter = player.character!;
  const guildId = recruiterCharacter.row.guild_id;
  const config = player.config.guild;
  if (guildId === null) return;
  if ((recruiterCharacter.row.guild_rank ?? NEW_MEMBER_RANK) > config.recruitRank) return;

  const member = player.server.getPlayer(packet.playerId);
  const memberCharacter = member?.character;
  if (member === undefined || memberCharacter == null || member === player) return;
  if (!joinerReady(player, member, memberCharacter)) return;
  const join = pendingJoins.get(member);
  if (join === undefined || join.guildId !== guildId || join.recruiterId !== player.id) return;
  pendingJoins.delete(member);

  const db = player.server.db;
  const guild = await getGuildById(db, guildId);
  if (guild === undefined) return;
  if (guild.bank < config.recruitCost) return sendReply(player, GuildReply.AccountLow);
  const ranks = await getGuildRanks(db, guildId);
  const rankName = ranks[RANK_COUNT - 1] || config.defaultNewMemberRankName;

  if (!stillMember(player, recruiterCharacter, guildId)) return;
  if (!joinerReady(player, member, memberCharacter)) return;

  memberCharacter.setGuild(guildId, guild.tag, guild.name, NEW_MEMBER_RANK, rankName);
  try {
    await memberCharacter.save(db, async (trx) => {
      if (!(await withdrawGuildBank(trx, guildId, config.recruitCost))) {
        throw new GuildBankRejected();
      }
    });
  } catch (err) {
    if (memberCharacter.row.guild_id === guildId) {
      memberCharacter.setGuild(null, null, null, null, null);
    }
    if (err instanceof GuildBankRejected) return sendReply(player, GuildReply.AccountLow);
    log.error({ player: player.id, err: String(err) }, 'guild recruit failed');
    return;
  }

  const agree = new GuildAgreeServerPacket();
  agree.recruiterId = player.id;
  agree.guildTag = guild.tag;
  agree.guildName = guild.name;
  agree.rankName = rankName;
  member.bus.send(agree);
  sendReply(player, GuildReply.Accepted);
  announce(
    player,
    guildId,
    lang('guild_joined', {
      member: capitalize(memberCharacter.name),
      recruiter: capitalize(recruiterCharacter.name),
    }),
  );
}

async function guildRemove(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildRemoveClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null) return;

  if (isLeader(character)) {
    const leaders = await countGuildLeaders(player.server.db, guildId);
    if (!stillMember(player, character, guildId)) return;
    if (leaders <= 1 && isLeader(character)) {
      sendTalkServer(
        player,
        'You are the last leader and cannot leave the guild. You must promote someone else to leader first.',
      );
      const agree = new GuildAgreeServerPacket();
      agree.recruiterId = player.id;
      agree.guildTag = character.guildTag ?? '';
      agree.guildName = character.guildName ?? '';
      agree.rankName = character.row.guild_rank_string ?? '';
      player.bus.send(agree);
      const accept = new GuildAcceptServerPacket();
      accept.rank = LEADER_RANK;
      player.bus.send(accept);
      return;
    }
  }

  const wasLeader = isLeader(character);
  character.setGuild(null, null, null, null, null);
  await character.save(player.server.db).catch((err: unknown) => {
    log.error({ player: player.id, err: String(err) }, 'failed to save guild leave');
  });
  announce(player, guildId, lang('guild_left', { member: capitalize(character.name) }));
  if (wasLeader) await ensureGuildLeader(player.server, guildId);
}

async function guildKick(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildKickClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null || !isLeader(character)) return;

  const db = player.server.db;
  const memberName = packet.memberName.toLowerCase();
  let member = findLoadedPlayer(player.server, memberName);
  let offline: GuildMemberRow | undefined;
  if (member === undefined) {
    offline = await getGuildMemberByName(db, guildId, memberName);
    if (!stillMember(player, character, guildId) || !isLeader(character)) return;
    member = findLoadedPlayer(player.server, memberName);
  }

  if (member !== undefined && member.character !== null) {
    const memberCharacter = member.character;
    if (memberCharacter.row.guild_id !== guildId) return sendReply(player, GuildReply.RemoveNotMember);
    if (isLeader(memberCharacter)) return sendReply(player, GuildReply.RemoveLeader);
    kickLoadedMember(member, memberCharacter);
    await memberCharacter.save(db).catch((err: unknown) => {
      log.error({ player: member?.id, err: String(err) }, 'failed to save guild kick');
    });
  } else {
    if (offline === undefined) return sendReply(player, GuildReply.RemoveNotMember);
    if (offline.guild_rank === LEADER_RANK) return sendReply(player, GuildReply.RemoveLeader);
    await clearMemberGuild(db, offline.id, guildId);
    const late = loadedMember(player, memberName, offline.id, guildId);
    if (late !== undefined) kickLoadedMember(late, late.character!);
  }

  sendReply(player, GuildReply.Removed);
  announce(
    player,
    guildId,
    lang('guild_kicked', { member: capitalize(memberName), name: capitalize(character.name) }),
  );
}

async function guildTake(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildTakeClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null) return;
  const db = player.server.db;

  switch (packet.infoType) {
    case GuildInfoType.Description: {
      const guild = await getGuildById(db, guildId);
      if (guild === undefined) return;
      const reply = new GuildTakeServerPacket();
      reply.description = guild.description === null || guild.description === '' ? ' ' : guild.description;
      player.bus.send(reply);
      return;
    }
    case GuildInfoType.Ranks: {
      const reply = new GuildRankServerPacket();
      reply.ranks = await getGuildRanks(db, guildId);
      player.bus.send(reply);
      return;
    }
    case GuildInfoType.Bank: {
      const guild = await getGuildById(db, guildId);
      if (guild === undefined) return;
      const reply = new GuildSellServerPacket();
      reply.goldAmount = guild.bank;
      player.bus.send(reply);
      return;
    }
  }
}

async function guildBuy(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildBuyClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  if (isTrading(player)) return;
  const config = player.config.guild;
  if (packet.goldAmount < config.minDeposit) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null) return;

  const db = player.server.db;
  const guild = await getGuildById(db, guildId);
  if (guild === undefined || !stillMember(player, character, guildId) || isTrading(player)) return;

  const requested = Math.min(packet.goldAmount, character.heldAmount(GOLD_ITEM));
  const capacity = Math.max(0, config.bankMaxGold - guild.bank);
  const deposited = Math.min(requested, capacity);
  if (deposited <= 0) return;

  character.removeItem(GOLD_ITEM, deposited);
  try {
    await character.save(db, async (trx) => {
      if (!(await depositGuildBank(trx, guildId, deposited, config.bankMaxGold))) {
        throw new GuildBankRejected();
      }
    });
  } catch (err) {
    character.addItem(GOLD_ITEM, deposited);
    if (!(err instanceof GuildBankRejected)) {
      log.error({ player: player.id, err: String(err) }, 'guild deposit failed');
    }
    return;
  }

  const reply = new GuildBuyServerPacket();
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  player.bus.send(reply);
  log.info({ cat: 'guild', character: character.name, guild: guild.tag, amount: deposited }, 'guild deposit');
}

async function guildAgree(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildAgreeClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null || !isLeader(character)) return;
  const db = player.server.db;

  const data = packet.infoTypeData;
  if (data instanceof GuildAgreeClientPacket.InfoTypeDataDescription) {
    if (!validDescription(player, data.description)) return;
    await updateGuildDescription(db, guildId, data.description);
    return sendReply(player, GuildReply.Updated);
  }
  if (data instanceof GuildAgreeClientPacket.InfoTypeDataRanks) {
    if (data.ranks.length < RANK_COUNT) return;
    for (const rank of data.ranks) {
      if (!validRankName(player, rank)) return;
    }
    const ranks = data.ranks.slice(0, RANK_COUNT);
    const changed = await updateGuildRanks(db, guildId, ranks);
    for (const member of loadedGuildMembers(player.server, guildId)) {
      const rank = member.character!.row.guild_rank;
      if (rank !== null && changed.includes(rank)) {
        member.character!.row.guild_rank_string = ranks[rank - 1] ?? '';
      }
    }
    return sendReply(player, GuildReply.RanksUpdated);
  }
}

async function guildRank(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildRankClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  if (packet.rank < LEADER_RANK || packet.rank > NEW_MEMBER_RANK) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null || !isLeader(character)) return;

  const db = player.server.db;
  const memberName = packet.memberName.toLowerCase();
  const ranks = await getGuildRanks(db, guildId);
  const rankString = ranks[packet.rank - 1] ?? '';
  let member = findLoadedPlayer(player.server, memberName);
  let offline: GuildMemberRow | undefined;
  if (member === undefined) {
    offline = await getGuildMemberByName(db, guildId, memberName);
    member = findLoadedPlayer(player.server, memberName);
  }
  if (!stillMember(player, character, guildId) || !isLeader(character)) return;

  if (member !== undefined && member.character !== null) {
    const memberCharacter = member.character;
    if (memberCharacter.row.guild_id !== guildId) return sendReply(player, GuildReply.RankingNotMember);
    if (isLeader(memberCharacter)) return sendReply(player, GuildReply.RankingLeader);
    rankLoadedMember(member, memberCharacter, packet.rank, rankString);
    await setMemberRank(db, memberCharacter.id, guildId, packet.rank, rankString);
  } else {
    if (offline === undefined) return sendReply(player, GuildReply.RankingNotMember);
    if (offline.guild_rank === LEADER_RANK) return sendReply(player, GuildReply.RankingLeader);
    await setMemberRank(db, offline.id, guildId, packet.rank, rankString);
    const late = loadedMember(player, memberName, offline.id, guildId);
    if (late !== undefined) rankLoadedMember(late, late.character!, packet.rank, rankString);
  }
  sendReply(player, GuildReply.Updated);
}

async function guildReport(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildReportClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;

  const db = player.server.db;
  const guild = await getGuildByIdentity(db, packet.guildIdentity);
  if (guild === undefined) return sendReply(player, GuildReply.NotFound);

  const ranks = await getGuildRanks(db, guild.id);
  const members = await getGuildMembers(db, guild.id);

  const reply = new GuildReportServerPacket();
  reply.name = guild.name;
  reply.tag = guild.tag;
  reply.createDate = toUtcDate(guild.created_at).toISOString().slice(0, 10);
  reply.description = guild.description === null || guild.description === '' ? ' ' : guild.description;
  reply.wealth = wealthLabel(guild.bank);
  reply.ranks = ranks.map((rank) => rank.padEnd(4, ' '));
  reply.staff = members
    .filter((m) => (m.guild_rank ?? NEW_MEMBER_RANK) <= 2)
    .map((m) => {
      const staff = new GuildStaff();
      staff.rank = m.guild_rank ?? NEW_MEMBER_RANK;
      staff.name = m.name;
      return staff;
    });
  player.bus.send(reply);
}

async function guildTell(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildTellClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;

  const db = player.server.db;
  const guild = await getGuildByIdentity(db, packet.guildIdentity);
  if (guild === undefined) return sendReply(player, GuildReply.NotFound);
  const members = await getGuildMembers(db, guild.id);
  if (members.length === 0) return sendReply(player, GuildReply.NotFound);

  const reply = new GuildTellServerPacket();
  reply.members = members.map((m) => {
    const member = new GuildMember();
    member.rank = m.guild_rank ?? NEW_MEMBER_RANK;
    member.name = m.name;
    member.rankName = m.guild_rank_string ?? '';
    return member;
  });
  player.bus.send(reply);
}

async function guildJunk(player: Player, reader: EoReader): Promise<void> {
  const packet = GuildJunkClientPacket.deserialize(reader);
  if (!inGame(player) || !atGuildMaster(player, packet.sessionId)) return;
  const character = player.character!;
  const guildId = character.row.guild_id;
  if (guildId === null || !isLeader(character)) return;
  const tag = character.guildTag;

  announce(player, guildId, lang('guild_disbanded', { name: capitalize(character.name) }));
  for (const member of loadedGuildMembers(player.server, guildId)) {
    pendingJoins.delete(member);
    kickLoadedMember(member, member.character!);
  }
  await deleteGuild(player.server.db, guildId);
  log.info({ guild: tag, leader: character.name }, 'guild disbanded');
}

export function handleGuild(
  player: Player,
  action: number,
  reader: EoReader,
): Promise<void> | void {
  switch (action) {
    case PacketAction.Open:
      return guildOpen(player, reader);
    case PacketAction.Request:
      return guildRequest(player, reader);
    case PacketAction.Accept:
      return guildAccept(player, reader);
    case PacketAction.Create:
      return guildCreate(player, reader);
    case PacketAction.Player:
      return guildPlayer(player, reader);
    case PacketAction.Use:
      return guildUse(player, reader);
    case PacketAction.Remove:
      return guildRemove(player, reader);
    case PacketAction.Kick:
      return guildKick(player, reader);
    case PacketAction.Take:
      return guildTake(player, reader);
    case PacketAction.Buy:
      return guildBuy(player, reader);
    case PacketAction.Agree:
      return guildAgree(player, reader);
    case PacketAction.Rank:
      return guildRank(player, reader);
    case PacketAction.Report:
      return guildReport(player, reader);
    case PacketAction.Tell:
      return guildTell(player, reader);
    case PacketAction.Junk:
      return guildJunk(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Guild action');
  }
}
