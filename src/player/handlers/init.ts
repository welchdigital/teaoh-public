import {
  CHAR_MAX,
  EoReader,
  InitBanType,
  InitInitClientPacket,
  InitInitServerPacket,
  InitReply,
  InitSequenceStart,
  PacketAction,
  Version,
  serverVerificationHash,
} from 'eolib';
import { normalizeHdid } from '../../account/accounts.ts';
import { findActiveBan, type ActiveBan } from '../../account/bans.ts';
import { compareVersions } from '../../config.ts';
import { log } from '../../log.ts';
import { generateEncryptionMultiple } from '../../net/crypto.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

function parseVersion(version: string): Version {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  const result = new Version();
  result.major = major;
  result.minor = minor;
  result.patch = patch;
  return result;
}

function sendOutOfDate(player: Player, version: string): void {
  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.OutOfDate;
  const data = new InitInitServerPacket.ReplyCodeDataOutOfDate();
  data.version = parseVersion(version);
  reply.replyCodeData = data;
  player.bus.send(reply);
}

function sendBanned(player: Player, ban: ActiveBan): void {
  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.Banned;
  const data = new InitInitServerPacket.ReplyCodeDataBanned();
  if (ban.permanent || ban.minutesRemaining === null) {
    data.banType = InitBanType.Permanent;
  } else {
    data.banType = InitBanType.Temporary;
    const temporary = new InitInitServerPacket.ReplyCodeDataBanned.BanTypeDataTemporary();
    temporary.minutesRemaining = Math.min(CHAR_MAX - 1, Math.max(1, ban.minutesRemaining));
    data.banTypeData = temporary;
  }
  reply.replyCodeData = data;
  player.bus.send(reply);
}

async function initRequest(player: Player, reader: EoReader): Promise<void> {
  if (player.state !== ClientState.Uninitialized) {
    player.close('INIT received after handshake');
    return;
  }

  const request = InitInitClientPacket.deserialize(reader);
  const hdid = normalizeHdid(request.hdid);
  if (hdid === null) {
    player.close('invalid hdid');
    return;
  }
  player.hdid = hdid;

  const ban = await findActiveBan(player.server.db, { ip: player.ip, hdid });
  if (player.closed) return;
  if (ban !== null) {
    sendBanned(player, ban);
    player.close(`banned (ban ${ban.id})`);
    return;
  }

  const { server } = player.config;

  const clientVersion = `${request.version.major}.${request.version.minor}.${request.version.patch}`;
  if (compareVersions(clientVersion, server.maxVersion) > 0) {
    sendOutOfDate(player, server.maxVersion);
    player.close(`client too new (${clientVersion})`);
    return;
  }
  if (compareVersions(clientVersion, server.minVersion) < 0) {
    sendOutOfDate(player, server.minVersion);
    player.close(`client too old (${clientVersion})`);
    return;
  }

  player.version = request.version;

  const sequenceStart = InitSequenceStart.generate();
  player.bus.sequencer.sequenceStart = sequenceStart;
  player.bus.clientEncryptionMultiple = generateEncryptionMultiple();
  player.bus.serverEncryptionMultiple = generateEncryptionMultiple();
  player.state = ClientState.Initialized;

  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.Ok;
  const ok = new InitInitServerPacket.ReplyCodeDataOk();
  ok.seq1 = sequenceStart.seq1;
  ok.seq2 = sequenceStart.seq2;
  ok.serverEncryptionMultiple = player.bus.serverEncryptionMultiple;
  ok.clientEncryptionMultiple = player.bus.clientEncryptionMultiple;
  ok.challengeResponse = serverVerificationHash(request.challenge);
  ok.playerId = player.id;
  reply.replyCodeData = ok;

  player.bus.send(reply);
  log.info(
    { player: player.id, ip: player.ip, version: clientVersion, deep: player.isDeep },
    'client initialized',
  );
}

export function handleInit(player: Player, action: number, reader: EoReader): Promise<void> | void {
  switch (action) {
    case PacketAction.Init:
      return initRequest(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Init action');
  }
}
