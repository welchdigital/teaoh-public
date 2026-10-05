import {
  EoReader,
  LoginReply,
  LoginReplyServerPacket,
  PacketAction,
} from 'eolib';
import {
  deleteSessions,
  generateSessionToken,
  getAccountEmail,
  getAccountLock,
  getCharacterList,
  getPasswordRow,
  getSession,
  hashSessionToken,
  maskEmail,
  recordLoginEvent,
  sessionExpired,
  updateLastLogin,
  updatePasswordHash,
  validateAccountName,
  validPasswordLength,
} from '../../account/accounts.ts';
import { findActiveBan } from '../../account/bans.ts';
import { generateEmailPin, pinMatches } from '../../account/email.ts';
import { hashPassword, PasswordBusyError, PASSWORD_VERSION, verifyPassword } from '../../account/password.ts';
import {
  AccountRecoverPinReply,
  AccountRecoverReply,
  AccountRecoverUpdateReply,
  DeepLoginReplyServerPacket,
  DeepLoginRequestClientPacket,
  LoginAcceptClientPacket,
  LoginAcceptServerPacket,
  LoginAgreeClientPacket,
  LoginAgreeServerPacket,
  LoginConfigServerPacket,
  LoginCreateClientPacket,
  LoginCreateServerPacket,
  LoginTakeClientPacket,
  LoginTakeServerPacket,
  LoginUseClientPacket,
} from '../../deep/index.ts';
import { renderTemplate } from '../../lang.ts';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

type LoginReplyData = LoginReplyServerPacket['replyCodeData'];

function sendReply(player: Player, replyCode: number): void {
  const reply = new LoginReplyServerPacket();
  reply.replyCode = replyCode;
  reply.replyCodeData = replyDataFor(replyCode);
  player.bus.send(reply);
}

function replyDataFor(replyCode: number): LoginReplyData {
  switch (replyCode) {
    case LoginReply.WrongUser:
      return new LoginReplyServerPacket.ReplyCodeDataWrongUser();
    case LoginReply.WrongUserPassword:
      return new LoginReplyServerPacket.ReplyCodeDataWrongUserPassword();
    case LoginReply.Banned:
      return new LoginReplyServerPacket.ReplyCodeDataBanned();
    case LoginReply.LoggedIn:
      return new LoginReplyServerPacket.ReplyCodeDataLoggedIn();
    case LoginReply.Busy:
      return new LoginReplyServerPacket.ReplyCodeDataBusy();
    default:
      return null;
  }
}

function failAttempt(player: Player, replyCode: number, reason: string): void {
  if (player.loginAttempts >= player.config.server.maxLoginAttempts) {
    player.close(reason);
    return;
  }
  sendReply(player, replyCode);
}

function rejectIfBusy(player: Player): boolean {
  if (player.server.playerCount() < player.config.server.maxPlayers) return false;
  sendReply(player, LoginReply.Busy);
  player.close('server busy');
  return true;
}

function rejectIfThrottled(player: Player, accountName: string | null): boolean {
  if (!player.server.authThrottle.loginBlocked(player.ip, accountName)) return false;
  sendReply(player, LoginReply.Busy);
  player.close('too many failed login attempts');
  return true;
}

function hashingBusy(player: Player, err: unknown): void {
  if (!(err instanceof PasswordBusyError)) throw err;
  if (player.closed) return;
  sendReply(player, LoginReply.Busy);
  player.close('password hashing busy');
}

async function accountBlocked(player: Player, accountId: number, locked: boolean): Promise<boolean> {
  const ban = await findActiveBan(player.server.db, {
    accountId,
    ip: player.ip,
    hdid: player.hdid,
  });
  if (player.closed) return true;
  if (ban === null && !locked) return false;
  sendReply(player, LoginReply.Banned);
  player.close(ban !== null ? `account is banned (ban ${ban.id})` : 'account is locked');
  return true;
}

async function loginRequest(player: Player, reader: EoReader): Promise<void> {
  const { request, rememberMe } = DeepLoginRequestClientPacket.deserialize(reader);

  if (player.state !== ClientState.Accepted) {
    player.close('logging in before connection accepted');
    return;
  }

  if (rejectIfBusy(player)) return;

  const username = request.username.toLowerCase();
  player.loginAttempts++;
  const throttle = player.server.authThrottle;
  if (rejectIfThrottled(player, username)) return;

  if (!validateAccountName(username)) {
    throttle.recordLoginFailure(player.ip, null);
    failAttempt(player, LoginReply.WrongUser, 'too many login attempts');
    return;
  }

  const row = await getPasswordRow(player.server.db, username);
  if (player.closed) return;
  if (row === undefined) {
    throttle.recordLoginFailure(player.ip, null);
    failAttempt(player, LoginReply.WrongUser, 'too many login attempts');
    return;
  }

  if (await accountBlocked(player, row.id, row.locked_at !== null)) return;

  let valid = false;
  if (request.password.length <= player.config.account.maxPasswordLength) {
    try {
      valid = await verifyPassword(row.name, request.password, row.password_hash);
    } catch (err) {
      hashingBusy(player, err);
      return;
    }
  }
  if (player.closed) return;
  if (!valid) {
    throttle.recordLoginFailure(player.ip, row.name);
    failAttempt(player, LoginReply.WrongUserPassword, 'too many login attempts');
    return;
  }

  if (!player.reserveAccount(row.id)) {
    failAttempt(player, LoginReply.LoggedIn, 'too many login attempts');
    return;
  }

  await finishLogin(player, row.id, rememberMe);
}

async function finishLogin(player: Player, accountId: number, rememberMe: boolean): Promise<void> {
  const { db, pubData } = player.server;
  let completed = false;
  try {
    const sessionToken = rememberMe ? await generateSessionToken(db, accountId) : null;
    if (player.closed) return;
    const characters = await getCharacterList(db, accountId, pubData);
    if (player.closed) return;
    if (!player.confirmLogin(accountId)) return;
    completed = true;
    player.state = ClientState.LoggedIn;
    player.loginAttempts = 0;

    if (player.isDeep) {
      const config = new LoginConfigServerPacket();
      config.maxSkins = player.config.character.maxSkin + 1;
      config.maxHairModels = player.config.character.maxHairStyle;
      config.maxCharacterName = player.config.character.maxNameLength;
      player.bus.send(config);
    }

    const reply = new LoginReplyServerPacket();
    reply.replyCode = LoginReply.Ok;
    const ok = new LoginReplyServerPacket.ReplyCodeDataOk();
    ok.characters = characters;
    reply.replyCodeData = ok;
    player.bus.send(new DeepLoginReplyServerPacket(reply, sessionToken));

    log.info({ cat: 'connection', player: player.id, account: accountId }, 'account logged in');
  } finally {
    if (!completed) player.releaseAccountReservation();
  }

  try {
    await Promise.all([
      recordLoginEvent(db, 'login', accountId, player.ip),
      updateLastLogin(db, accountId, player.ip),
    ]);
  } catch (err) {
    log.error({ player: player.id, err: String(err) }, 'failed to record login');
  }
}

async function loginUse(player: Player, reader: EoReader): Promise<void> {
  const { token } = LoginUseClientPacket.deserialize(reader);
  if (token.length === 0) return;
  if (player.state !== ClientState.Accepted) {
    player.close('logging in before connection accepted');
    return;
  }

  if (rejectIfBusy(player)) return;
  player.loginAttempts++;
  if (rejectIfThrottled(player, null)) return;

  const { db } = player.server;
  const session = await getSession(db, token);
  if (player.closed) return;
  if (session === undefined || sessionExpired(session)) {
    player.server.authThrottle.recordLoginFailure(player.ip, null);
    failAttempt(player, LoginReply.WrongUserPassword, 'too many login attempts');
    return;
  }

  const lock = await getAccountLock(db, session.account_id);
  if (player.closed) return;
  if (await accountBlocked(player, session.account_id, lock !== null)) {
    await deleteSessions(db, session.account_id);
    return;
  }

  if (!player.reserveAccount(session.account_id)) {
    failAttempt(player, LoginReply.LoggedIn, 'too many login attempts');
    return;
  }

  try {
    await db.deleteFrom('account_sessions').where('token_hash', '=', hashSessionToken(token)).execute();
  } catch (err) {
    player.releaseAccountReservation();
    throw err;
  }
  if (player.closed) return;

  await finishLogin(player, session.account_id, true);
}

function recoveryAvailable(player: Player): boolean {
  return player.config.account.recovery && player.server.mailer.configured;
}

function loginTake(player: Player, reader: EoReader): void {
  LoginTakeClientPacket.deserialize(reader);
  if (player.state !== ClientState.Accepted) return;
  const reply = new LoginTakeServerPacket();
  reply.replyCode = recoveryAvailable(player)
    ? AccountRecoverReply.RequestAccepted
    : AccountRecoverReply.RecoveryDisabled;
  player.bus.send(reply);
}

function sendLoginCreate(player: Player, replyCode: AccountRecoverReply, email: string | null = null): void {
  const reply = new LoginCreateServerPacket();
  reply.replyCode = replyCode;
  reply.emailAddress = email;
  player.bus.send(reply);
}

async function loginCreate(player: Player, reader: EoReader): Promise<void> {
  const create = LoginCreateClientPacket.deserialize(reader);
  if (player.state !== ClientState.Accepted) return;
  if (!recoveryAvailable(player)) {
    sendLoginCreate(player, AccountRecoverReply.RecoveryDisabled);
    return;
  }

  const { account } = player.config;
  const limiter = player.server.emailLimiter;
  if (!limiter.tryConsume(`ip:${player.ip}`, account.maxEmailsPerIp)) {
    sendLoginCreate(player, AccountRecoverReply.TooManyEmails);
    return;
  }

  const name = create.accountName.toLowerCase();
  const row = await getAccountEmail(player.server.db, name);
  if (player.closed) return;
  if (row === undefined) {
    sendLoginCreate(player, AccountRecoverReply.AccountNotFound);
    return;
  }

  if (!limiter.tryConsume(`account:${row.id}`, account.maxEmailsPerAccount)) {
    sendLoginCreate(player, AccountRecoverReply.TooManyEmails);
    return;
  }

  const pin = generateEmailPin();
  player.emailPin = {
    purpose: 'recovery',
    pin,
    accountId: row.id,
    accountName: row.name,
    email: row.email,
    expiresAt: Date.now() + account.emailPinTtl * 60_000,
    attempts: 0,
    verified: false,
  };

  const template = player.server.emailTemplates.recovery;
  const values = {
    name: row.name,
    code: pin,
    minutes: account.emailPinTtl,
    server: player.config.sln.serverName,
  };
  try {
    await player.server.mailer.send({
      to: row.email,
      toName: row.name,
      subject: renderTemplate(template.subject, values),
      text: renderTemplate(template.body, values),
    });
  } catch (err) {
    log.error({ player: player.id, account: row.id, err: String(err) }, 'failed to send recovery email');
    if (player.closed) return;
    player.emailPin = null;
    sendLoginCreate(player, AccountRecoverReply.Busy);
    return;
  }
  if (player.closed) return;

  log.info({ player: player.id, account: row.id }, 'recovery email sent');
  if (account.recoveryShowEmail) {
    const shown = account.recoveryMaskEmail ? maskEmail(row.email) : row.email;
    sendLoginCreate(player, AccountRecoverReply.RequestAcceptedShowEmail, shown);
  } else {
    sendLoginCreate(player, AccountRecoverReply.RequestAccepted);
  }
}

function activeRecoveryPin(player: Player) {
  const pin = player.emailPin;
  if (pin === null || pin.purpose !== 'recovery') return null;
  if (Date.now() > pin.expiresAt) {
    player.emailPin = null;
    return null;
  }
  return pin;
}

function recordPinFailure(player: Player): void {
  const pin = player.emailPin;
  if (pin === null) return;
  pin.attempts++;
  if (pin.attempts >= player.config.account.emailPinAttempts) player.emailPin = null;
}

function loginAccept(player: Player, reader: EoReader): void {
  const accept = LoginAcceptClientPacket.deserialize(reader);
  if (player.state !== ClientState.Accepted) return;

  const reply = new LoginAcceptServerPacket();
  const pin = activeRecoveryPin(player);
  if (pin !== null && pinMatches(pin.pin, accept.pin)) {
    pin.verified = true;
    reply.replyCode = AccountRecoverPinReply.Ok;
  } else {
    recordPinFailure(player);
    reply.replyCode = AccountRecoverPinReply.WrongPin;
  }
  player.bus.send(reply);
}

function sendLoginAgree(player: Player, replyCode: AccountRecoverUpdateReply): void {
  const reply = new LoginAgreeServerPacket();
  reply.replyCode = replyCode;
  player.bus.send(reply);
}

async function loginAgree(player: Player, reader: EoReader): Promise<void> {
  let agree: LoginAgreeClientPacket;
  try {
    agree = LoginAgreeClientPacket.deserialize(reader);
  } catch {
    sendLoginAgree(player, AccountRecoverUpdateReply.Error);
    return;
  }
  if (player.state !== ClientState.Accepted) return;

  const pin = activeRecoveryPin(player);
  if (
    pin === null ||
    !pin.verified ||
    pin.accountName !== agree.accountName.toLowerCase() ||
    !pinMatches(pin.pin, agree.pin)
  ) {
    recordPinFailure(player);
    sendLoginAgree(player, AccountRecoverUpdateReply.Error);
    return;
  }
  if (!validPasswordLength(agree.password, player.config.account)) {
    sendLoginAgree(player, AccountRecoverUpdateReply.Error);
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(pin.accountName, agree.password);
  } catch (err) {
    if (!(err instanceof PasswordBusyError)) throw err;
    if (!player.closed) sendLoginAgree(player, AccountRecoverUpdateReply.Error);
    return;
  }
  if (player.emailPin !== pin) return;
  player.emailPin = null;
  await updatePasswordHash(player.server.db, pin.accountId, passwordHash, PASSWORD_VERSION);
  log.info({ player: player.id, account: pin.accountId }, 'account password recovered');
  if (player.closed) return;
  sendLoginAgree(player, AccountRecoverUpdateReply.Ok);
}

export function handleLogin(player: Player, action: number, reader: EoReader): Promise<void> | void {
  switch (action) {
    case PacketAction.Request:
      return loginRequest(player, reader);
    case PacketAction.Use:
      return loginUse(player, reader);
    case PacketAction.Take:
      return loginTake(player, reader);
    case PacketAction.Create:
      return loginCreate(player, reader);
    case PacketAction.Accept:
      return loginAccept(player, reader);
    case PacketAction.Agree:
      return loginAgree(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Login action');
  }
}
