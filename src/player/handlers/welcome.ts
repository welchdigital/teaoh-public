import {
  Coords,
  EoReader,
  FileType,
  InitInitServerPacket,
  InitReply,
  LoginMessageCode,
  MapFile,
  PacketAction,
  PubFile,
  ServerSettings,
  SitState,
  WelcomeAgreeClientPacket,
  WelcomeCode,
  WelcomeMsgClientPacket,
  WelcomeReplyServerPacket,
  WelcomeRequestClientPacket,
} from 'eolib';
import { recordLoginEvent } from '../../account/accounts.ts';
import { Character } from '../../character/character.ts';
import { spawnLocation } from '../../character/spawn-location.ts';
import { log } from '../../log.ts';
import { splitPubFile, type PubKind } from '../../net/pub-split.ts';
import { getNearbyInfo } from '../../world/map/visibility.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

async function welcomeRequest(player: Player, reader: EoReader): Promise<void> {
  const request = WelcomeRequestClientPacket.deserialize(reader);
  if (player.state !== ClientState.LoggedIn) return;

  if (player.server.playerCount() > player.config.server.maxPlayers) {
    const busy = new WelcomeReplyServerPacket();
    busy.welcomeCode = WelcomeCode.ServerBusy;
    player.bus.send(busy);
    return;
  }

  const character = await Character.load(player.server.db, request.characterId);
  if (player.closed || player.state !== ClientState.LoggedIn) return;
  if (character === null || character.accountId !== player.accountId) {
    player.close(`invalid character selection for id ${request.characterId}`);
    return;
  }
  character.playerId = player.id;
  character.calculateStats(player.server.formulas, player.server.pubData, player.config.combat);

  if (character.mapId === 0) {
    const spawn = spawnLocation(character, player.server.pubData, player.config.world);
    character.mapId = spawn.map;
    character.setCoords(spawn.x, spawn.y);
    character.row.hp = character.maxHp;
  }

  let map = player.server.world.getMap(character.mapId);
  if (map === undefined) {
    map = player.server.world.getMap(player.config.world.rescueMap);
    if (map === undefined) {
      player.close(`rescue map ${player.config.world.rescueMap} not found`);
      return;
    }
    character.mapId = map.id;
    character.setCoords(player.config.world.rescueX, player.config.world.rescueY);
  }

  player.character = character;
  player.usageTicks = player.config.world.usageRate;
  player.state = ClientState.EnteringGame;

  const pub = player.server.pubData;
  const data = new WelcomeReplyServerPacket.WelcomeCodeDataSelectCharacter();
  data.sessionId = player.generateSessionId();
  data.characterId = character.id;
  data.mapId = character.mapId;
  data.mapRid = map.rid;
  data.mapFileSize = map.fileSize;
  data.eifRid = pub.eif?.rid ?? [0, 0];
  data.eifLength = pub.eif?.length ?? 0;
  data.enfRid = pub.enf?.rid ?? [0, 0];
  data.enfLength = pub.enf?.length ?? 0;
  data.esfRid = pub.esf?.rid ?? [0, 0];
  data.esfLength = pub.esf?.length ?? 0;
  data.ecfRid = pub.ecf?.rid ?? [0, 0];
  data.ecfLength = pub.ecf?.length ?? 0;
  data.name = character.name;
  data.title = character.row.title ?? '';
  data.guildName = character.guildName ?? '';
  data.guildRankName = character.row.guild_rank_string ?? '';
  data.classId = character.row.class;
  data.guildTag = (character.guildTag ?? '').padEnd(3, ' ');
  data.admin = character.row.admin_level;
  data.level = character.row.level;
  data.experience = character.row.experience;
  data.usage = character.row.usage;
  data.stats = character.statsWelcome();
  data.equipment = character.equipmentWelcome();
  data.guildRank = character.row.guild_rank ?? 0;

  const settings = new ServerSettings();
  settings.jailMap = player.config.world.jailMap;
  settings.rescueMap = player.config.world.rescueMap;
  const rescueCoords = new Coords();
  rescueCoords.x = player.config.world.rescueX;
  rescueCoords.y = player.config.world.rescueY;
  settings.rescueCoords = rescueCoords;
  settings.spyAndLightGuideFloodRate = 10;
  settings.guardianFloodRate = 10;
  settings.gameMasterFloodRate = 10;
  settings.highGameMasterFloodRate = 0;
  data.settings = settings;
  data.loginMessageCode = character.row.usage === 0 ? LoginMessageCode.Yes : LoginMessageCode.No;

  const reply = new WelcomeReplyServerPacket();
  reply.welcomeCode = WelcomeCode.SelectCharacter;
  reply.welcomeCodeData = data;
  player.bus.send(reply);
}

type PubFileTypeData =
  | InstanceType<typeof WelcomeAgreeClientPacket.FileTypeDataEif>
  | InstanceType<typeof WelcomeAgreeClientPacket.FileTypeDataEnf>
  | InstanceType<typeof WelcomeAgreeClientPacket.FileTypeDataEsf>
  | InstanceType<typeof WelcomeAgreeClientPacket.FileTypeDataEcf>;

function requestedFileId(agree: WelcomeAgreeClientPacket): number {
  const data = agree.fileTypeData as PubFileTypeData | null;
  return data === null ? 1 : data.fileId;
}

function welcomeAgree(player: Player, reader: EoReader): void {
  const agree = WelcomeAgreeClientPacket.deserialize(reader);
  if (player.state !== ClientState.EnteringGame) return;

  const sessionId = player.peekSessionId();
  if (sessionId === null || sessionId !== agree.sessionId) {
    player.close(`wrong session id: got ${agree.sessionId}, expected ${sessionId}`);
    return;
  }

  const pub = player.server.pubData;
  const reply = new InitInitServerPacket();

  switch (agree.fileType) {
    case FileType.Emf: {
      const map = player.character === null
        ? undefined
        : player.server.world.getMap(player.character.mapId);
      if (map === undefined) {
        player.close('map file requested with no valid character map');
        return;
      }
      reply.replyCode = InitReply.FileEmf;
      const data = new InitInitServerPacket.ReplyCodeDataFileEmf();
      const file = new MapFile();
      file.content = map.fileBytes;
      data.mapFile = file;
      reply.replyCodeData = data;
      break;
    }
    case FileType.Eif: {
      reply.replyCode = InitReply.FileEif;
      const data = new InitInitServerPacket.ReplyCodeDataFileEif();
      data.pubFile = pubFile(pub.eif?.bytes, 'eif', requestedFileId(agree));
      reply.replyCodeData = data;
      break;
    }
    case FileType.Enf: {
      reply.replyCode = InitReply.FileEnf;
      const data = new InitInitServerPacket.ReplyCodeDataFileEnf();
      data.pubFile = pubFile(pub.enf?.bytes, 'enf', requestedFileId(agree));
      reply.replyCodeData = data;
      break;
    }
    case FileType.Esf: {
      reply.replyCode = InitReply.FileEsf;
      const data = new InitInitServerPacket.ReplyCodeDataFileEsf();
      data.pubFile = pubFile(pub.esf?.bytes, 'esf', requestedFileId(agree));
      reply.replyCodeData = data;
      break;
    }
    case FileType.Ecf: {
      reply.replyCode = InitReply.FileEcf;
      const data = new InitInitServerPacket.ReplyCodeDataFileEcf();
      data.pubFile = pubFile(pub.ecf?.bytes, 'ecf', requestedFileId(agree));
      reply.replyCodeData = data;
      break;
    }
    default:
      return;
  }

  player.bus.send(reply);
}

function pubFile(bytes: Uint8Array | undefined, kind: PubKind, fileId: number): PubFile {
  const file = new PubFile();
  if (bytes === undefined) {
    file.fileId = 1;
    file.content = new Uint8Array(0);
    return file;
  }
  const chunks = splitPubFile(bytes, kind);
  if (chunks.length === 0) throw new Error(`${kind} pub file cannot be served`);
  const index = fileId >= 1 && fileId <= chunks.length ? fileId - 1 : 0;
  file.fileId = index + 1;
  file.content = chunks[index] ?? new Uint8Array(0);
  return file;
}

function welcomeMsg(player: Player, reader: EoReader): void {
  const msg = WelcomeMsgClientPacket.deserialize(reader);
  if (player.state !== ClientState.EnteringGame) return;

  const sessionId = player.takeSessionId();
  if (sessionId === null || sessionId !== msg.sessionId) {
    player.close(`wrong session id: got ${msg.sessionId}, expected ${sessionId}`);
    return;
  }

  const character = player.character;
  if (character === null) {
    player.close('entering game with no character selected');
    return;
  }

  const map = player.server.world.getMap(character.mapId);
  if (map === undefined) {
    player.close(`map ${character.mapId} not found on enter game`);
    return;
  }

  if (map.emf.relogX > 0) {
    character.setCoords(map.emf.relogX, map.emf.relogY);
    character.row.sitting = SitState.Stand;
  }

  player.map = map;
  player.state = ClientState.InGame;
  map.enter(character, player);

  const data = new WelcomeReplyServerPacket.WelcomeCodeDataEnterGame();
  data.news = newsLines(player.server.news);
  data.weight = character.weight(player.server.pubData);
  data.items = character.items;
  data.spells = character.spells;
  data.nearby = getNearbyInfo(map, character.row.x, character.row.y, character.playerId);

  const reply = new WelcomeReplyServerPacket();
  reply.welcomeCode = WelcomeCode.EnterGame;
  reply.welcomeCodeData = data;
  player.bus.send(reply);

  log.info(
    { player: player.id, character: character.name, map: character.mapId },
    'entered game',
  );
  void recordLoginEvent(player.server.db, 'enter', player.accountId, player.ip, character.id).catch(
    (err: unknown) => log.error({ player: player.id, err: String(err) }, 'failed to record enter game'),
  );
}

function newsLines(news: string[]): string[] {
  const lines = news.slice(0, 9);
  while (lines.length < 9) lines.push('');
  return lines;
}

export function handleWelcome(
  player: Player,
  action: number,
  reader: EoReader,
): Promise<void> | void {
  switch (action) {
    case PacketAction.Request:
      return welcomeRequest(player, reader);
    case PacketAction.Agree:
      return welcomeAgree(player, reader);
    case PacketAction.Msg:
      return welcomeMsg(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Welcome action');
  }
}
