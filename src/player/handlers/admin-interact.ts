import {
  AdminInteractReplyServerPacket,
  AdminInteractReportClientPacket,
  AdminInteractTellClientPacket,
  AdminLevel,
  AdminMessageType,
  EoReader,
  PacketAction,
} from 'eolib';
import { sendTalkServer } from '../../admin/actions.ts';
import { itemDropLines, npcDropLines } from '../../admin/lookups.ts';
import { createReport, type ReportKind } from '../../admin/reports.ts';
import { adminState, databaseOf } from '../../admin/state.ts';
import { AdminInteractAddServerPacket, AdminInteractTakeClientPacket, LookupType } from '../../deep/admin-interact.ts';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { postToAdminBoard } from './board.ts';
import { capitalize, findOnlinePlayer, inGame } from './common.ts';

export const MAX_REPORT_MESSAGE = 512;

function notifyAdmins(player: Player, packet: AdminInteractReplyServerPacket): number {
  const sender = player.character?.name;
  let notified = 0;
  for (const other of player.server.allPlayers()) {
    if (
      other.state === ClientState.InGame &&
      other.character !== null &&
      other.character.name !== sender &&
      other.character.row.admin_level >= AdminLevel.Spy
    ) {
      other.bus.send(packet);
      notified++;
    }
  }
  return notified;
}

function onCooldown(player: Player, now: number): boolean {
  const character = player.character!;
  const cooldowns = adminState(player.server).reportCooldowns;
  const seconds = player.config.admin.reportCooldown;
  const last = cooldowns.get(character.id);
  if (last !== undefined && now - last < seconds * 1000) {
    const wait = Math.ceil((seconds * 1000 - (now - last)) / 1000);
    sendTalkServer(player, `Please wait ${wait} second${wait === 1 ? '' : 's'} before contacting the staff again.`);
    return true;
  }
  cooldowns.set(character.id, now);
  for (const [id, at] of cooldowns) {
    if (now - at >= seconds * 1000) cooldowns.delete(id);
  }
  return false;
}

async function reporteeExists(player: Player, name: string): Promise<boolean> {
  const { minNameLength, maxNameLength } = player.config.character;
  if (name.length < minNameLength || name.length > maxNameLength || !/^[a-z]+$/.test(name)) return false;
  if (findOnlinePlayer(player.server, name) !== undefined) return true;
  const db = databaseOf(player.server);
  if (db === null) return false;
  const row = await db.selectFrom('characters').select('id').where('name', '=', name).executeTakeFirst();
  return row !== undefined;
}

async function persist(
  player: Player,
  kind: ReportKind,
  reportee: string | null,
  subject: string,
  message: string,
): Promise<void> {
  const character = player.character!;
  const author = { id: character.id, name: character.name };
  const db = databaseOf(player.server);
  let reportId: number | null = null;
  if (db !== null) {
    try {
      reportId = await createReport(db, {
        kind,
        reporterId: character.id,
        reporter: character.name,
        reportee,
        message,
      });
    } catch (err) {
      log.error({ cat: 'report', reporter: character.name, err: String(err) }, 'failed to store report');
    }
  }
  const posted = db === null ? false : await postToAdminBoard(player.server, author, subject, message);
  log.info(
    { cat: 'report', kind, reporter: character.name, reportee, message, reportId, posted },
    kind === 'report' ? 'player report' : 'staff request',
  );
}

async function adminReport(player: Player, reader: EoReader): Promise<void> {
  const packet = AdminInteractReportClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  const message = packet.message.trim().slice(0, MAX_REPORT_MESSAGE);
  const reportee = packet.reportee.trim().toLowerCase();
  if (message.length === 0) return;
  if (reportee === character.name) {
    sendTalkServer(player, 'You cannot report yourself.');
    return;
  }
  if (!(await reporteeExists(player, reportee))) {
    sendTalkServer(player, `Player ${packet.reportee.trim()} was not found.`);
    return;
  }
  if (!inGame(player) || onCooldown(player, Date.now())) return;

  const reply = new AdminInteractReplyServerPacket();
  reply.messageType = AdminMessageType.Report;
  const data = new AdminInteractReplyServerPacket.MessageTypeDataReport();
  data.playerName = character.name;
  data.message = message;
  data.reporteeName = reportee;
  reply.messageTypeData = data;
  notifyAdmins(player, reply);

  await persist(
    player,
    'report',
    reportee,
    `[Report] ${capitalize(character.name)} reports ${capitalize(reportee)}`,
    message,
  );
}

async function adminTell(player: Player, reader: EoReader): Promise<void> {
  const packet = AdminInteractTellClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;
  const message = packet.message.trim().slice(0, MAX_REPORT_MESSAGE);
  if (message.length === 0 || onCooldown(player, Date.now())) return;

  const reply = new AdminInteractReplyServerPacket();
  reply.messageType = AdminMessageType.Message;
  const data = new AdminInteractReplyServerPacket.MessageTypeDataMessage();
  data.playerName = character.name;
  data.message = message;
  reply.messageTypeData = data;
  notifyAdmins(player, reply);

  await persist(player, 'request', null, `[Request] ${capitalize(character.name)} needs help`, message);
}

function adminTake(player: Player, reader: EoReader): void {
  if (!player.config.world.infoRevealsDrops || !inGame(player)) return;
  const packet = AdminInteractTakeClientPacket.deserialize(reader);
  const { pubData, drops } = player.server;
  let lines;
  if (packet.lookupType === LookupType.Item) lines = itemDropLines(pubData, drops, packet.id);
  else if (packet.lookupType === LookupType.Npc) lines = npcDropLines(pubData, drops, packet.id);
  else return;
  if (lines.length === 0) return;
  const reply = new AdminInteractAddServerPacket();
  reply.lines = lines;
  player.bus.send(reply);
}

export function handleAdminInteract(player: Player, action: number, reader: EoReader): void | Promise<void> {
  switch (action) {
    case PacketAction.Report:
      return adminReport(player, reader);
    case PacketAction.Tell:
      return adminTell(player, reader);
    case PacketAction.Take:
      return adminTake(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled AdminInteract action');
  }
}
