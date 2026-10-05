import {
  AccountAgreeClientPacket,
  AccountReply,
  AccountReplySequenceStart,
  AccountReplyServerPacket,
  AccountRequestClientPacket,
  EoReader,
  PacketAction,
} from 'eolib';
import {
  accountExists,
  getPasswordRow,
  normalizeEmail,
  normalizeHdid,
  recordLoginEvent,
  updatePasswordHash,
  validAccountField,
  validateAccountName,
  validPasswordLength,
} from '../../account/accounts.ts';
import { generateEmailPin, pinMatches } from '../../account/email.ts';
import { hashPassword, PasswordBusyError, PASSWORD_VERSION, verifyPassword } from '../../account/password.ts';
import {
  ACCOUNT_REPLY_WRONG_PIN,
  AccountAcceptClientPacket,
  AccountAcceptServerPacket,
  AccountConfigServerPacket,
  AccountValidationReply,
  DeepAccountCreateClientPacket,
} from '../../deep/index.ts';
import { renderTemplate } from '../../lang.ts';
import { log } from '../../log.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

type AccountReplyData = AccountReplyServerPacket['replyCodeData'];

function sendReply(player: Player, replyCode: number, data?: AccountReplyData): void {
  const reply = new AccountReplyServerPacket();
  reply.replyCode = replyCode;
  reply.replyCodeData = data ?? replyDataFor(replyCode);
  player.bus.send(reply);
}

function replyDataFor(replyCode: number): AccountReplyData {
  switch (replyCode) {
    case AccountReply.Exists:
      return new AccountReplyServerPacket.ReplyCodeDataExists();
    case AccountReply.NotApproved:
      return new AccountReplyServerPacket.ReplyCodeDataNotApproved();
    case AccountReply.Created:
      return new AccountReplyServerPacket.ReplyCodeDataCreated();
    case AccountReply.ChangeFailed:
      return new AccountReplyServerPacket.ReplyCodeDataChangeFailed();
    case AccountReply.Changed:
      return new AccountReplyServerPacket.ReplyCodeDataChanged();
    case AccountReply.RequestDenied:
      return new AccountReplyServerPacket.ReplyCodeDataRequestDenied();
    default:
      return null;
  }
}

async function accountRequest(player: Player, reader: EoReader): Promise<void> {
  const request = AccountRequestClientPacket.deserialize(reader);
  if (player.state !== ClientState.Accepted) return;
  if (validationUnsupported(player)) {
    sendReply(player, AccountReply.RequestDenied);
    return;
  }

  const username = request.username.toLowerCase();
  if (!validateAccountName(username)) {
    sendReply(player, AccountReply.NotApproved);
    return;
  }

  const exists = await accountExists(player.server.db, username);
  if (player.closed) return;
  if (exists) {
    sendReply(player, AccountReply.Exists);
    return;
  }

  if (player.isDeep) {
    const config = new AccountConfigServerPacket();
    config.delayTime = player.config.account.delayTime;
    config.emailValidation = emailValidationEnabled(player);
    player.bus.send(config);
  }

  const sessionId = player.generateSessionId();
  const sequenceStart = AccountReplySequenceStart.generate();
  player.bus.sequencer.sequenceStart = sequenceStart;

  const data = new AccountReplyServerPacket.ReplyCodeDataDefault();
  data.sequenceStart = sequenceStart.value;
  sendReply(player, sessionId, data);
}

function emailValidationEnabled(player: Player): boolean {
  return player.config.account.emailValidation && player.server.mailer.configured;
}

function validationUnsupported(player: Player): boolean {
  return emailValidationEnabled(player) && !player.isDeep;
}

function validCreateFields(player: Player, create: DeepAccountCreateClientPacket['create']): boolean {
  return (
    validPasswordLength(create.password, player.config.account) &&
    validAccountField(create.fullName) &&
    validAccountField(create.location) &&
    validAccountField(create.computer) &&
    normalizeHdid(create.hdid) !== null
  );
}

function checkValidationPin(
  player: Player,
  username: string,
  email: string,
  pin: string | null,
): boolean {
  const { account } = player.config;
  if (!emailValidationEnabled(player)) return true;

  const expected = player.emailPin;
  if (expected === null || expected.purpose !== 'validation' || Date.now() > expected.expiresAt) {
    player.emailPin = null;
    return false;
  }
  if (
    pin !== null &&
    expected.accountName === username &&
    expected.email === email &&
    pinMatches(expected.pin, pin)
  ) {
    return true;
  }
  expected.attempts++;
  if (expected.attempts >= account.emailPinAttempts) player.emailPin = null;
  return false;
}

async function accountCreate(player: Player, reader: EoReader): Promise<void> {
  const packet = DeepAccountCreateClientPacket.deserialize(reader);
  const create = packet.create;
  if (player.state !== ClientState.Accepted) return;
  if (validationUnsupported(player)) {
    sendReply(player, AccountReply.RequestDenied);
    return;
  }

  const email = normalizeEmail(create.email);
  const username = create.username.toLowerCase();

  if (!checkValidationPin(player, username, email ?? '', packet.pin)) {
    sendReply(player, ACCOUNT_REPLY_WRONG_PIN);
    return;
  }

  const sessionId = player.takeSessionId();
  if (sessionId === null || sessionId !== create.sessionId) {
    player.close(`wrong session id: got ${create.sessionId}, expected ${sessionId}`);
    return;
  }

  if (email === null || !validateAccountName(username) || !validCreateFields(player, create)) {
    sendReply(player, AccountReply.NotApproved);
    return;
  }

  const exists = await accountExists(player.server.db, username);
  if (player.closed) return;
  if (exists) {
    sendReply(player, AccountReply.Exists);
    return;
  }

  const denied = player.server.authThrottle.tryCreate(player.ip, player);
  if (denied !== null) {
    log.warn({ cat: 'account', player: player.id, ip: player.ip }, `account creation denied: ${denied}`);
    sendReply(player, AccountReply.RequestDenied);
    return;
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(username, create.password);
  } catch (err) {
    if (!(err instanceof PasswordBusyError)) throw err;
    log.warn({ cat: 'account', player: player.id }, 'account creation denied: password hashing busy');
    if (!player.closed) sendReply(player, AccountReply.RequestDenied);
    return;
  }
  if (player.closed) return;
  const inserted = await player.server.db
    .insertInto('accounts')
    .values({
      name: username,
      password_hash: passwordHash,
      password_version: PASSWORD_VERSION,
      real_name: create.fullName,
      location: create.location,
      email,
      computer: create.computer,
      hdid: normalizeHdid(create.hdid) ?? '',
    })
    .returning('id')
    .executeTakeFirst();

  if (inserted === undefined) {
    player.close('error creating account');
    return;
  }

  player.emailPin = null;
  log.info({ player: player.id, account: username }, 'account created');
  await recordLoginEvent(player.server.db, 'create', inserted.id, player.ip).catch((err: unknown) => {
    log.error({ player: player.id, err: String(err) }, 'failed to record account creation');
  });
  if (player.closed) return;
  sendReply(player, AccountReply.Created);
}

async function accountAgree(player: Player, reader: EoReader): Promise<void> {
  const agree = AccountAgreeClientPacket.deserialize(reader);
  if (player.state !== ClientState.LoggedIn) return;

  const username = agree.username.toLowerCase();
  if (!validateAccountName(username)) {
    player.close('invalid account name');
    return;
  }

  player.loginAttempts++;
  const { account } = player.config;
  const throttle = player.server.authThrottle;
  if (throttle.loginBlocked(player.ip, username)) {
    sendReply(player, AccountReply.ChangeFailed);
    player.close('too many failed password attempts');
    return;
  }

  if (!validPasswordLength(agree.newPassword, account) || agree.oldPassword.length > account.maxPasswordLength) {
    failPasswordChange(player, AccountReply.ChangeFailed);
    return;
  }

  const row = await getPasswordRow(player.server.db, username);
  if (player.closed) return;
  if (row === undefined) {
    failPasswordChange(player, AccountReply.Exists);
    return;
  }

  try {
    const valid =
      row.id === player.accountId &&
      (await verifyPassword(row.name, agree.oldPassword, row.password_hash));
    if (player.closed) return;
    if (!valid) {
      throttle.recordLoginFailure(player.ip, row.name);
      failPasswordChange(player, AccountReply.ChangeFailed);
      return;
    }

    player.loginAttempts = 0;
    const passwordHash = await hashPassword(row.name, agree.newPassword);
    await updatePasswordHash(player.server.db, row.id, passwordHash, PASSWORD_VERSION);
  } catch (err) {
    if (!(err instanceof PasswordBusyError)) throw err;
    if (!player.closed) sendReply(player, AccountReply.ChangeFailed);
    return;
  }
  if (player.closed) return;

  sendReply(player, AccountReply.Changed);
}

function failPasswordChange(player: Player, replyCode: number): void {
  if (player.loginAttempts >= player.config.server.maxLoginAttempts) {
    player.close('too many password change attempts');
    return;
  }
  sendReply(player, replyCode);
}

function sendAccountAccept(player: Player, replyCode: AccountValidationReply): void {
  const reply = new AccountAcceptServerPacket();
  reply.replyCode = replyCode;
  player.bus.send(reply);
}

async function accountAccept(player: Player, reader: EoReader): Promise<void> {
  const accept = AccountAcceptClientPacket.deserialize(reader);
  const { account } = player.config;
  if (player.state !== ClientState.Accepted || !player.isDeep || !emailValidationEnabled(player)) return;

  const username = accept.accountName.toLowerCase();
  const email = normalizeEmail(accept.emailAddress);
  if (email === null || !validateAccountName(username)) {
    sendAccountAccept(player, AccountValidationReply.Busy);
    return;
  }

  const limiter = player.server.emailLimiter;
  if (
    !limiter.tryConsume(`ip:${player.ip}`, account.maxEmailsPerIp) ||
    !limiter.tryConsume(`email:${email}`, account.maxEmailsPerAccount)
  ) {
    sendAccountAccept(player, AccountValidationReply.TooManyAttempts);
    return;
  }

  const pin = generateEmailPin();
  player.emailPin = {
    purpose: 'validation',
    pin,
    accountId: 0,
    accountName: username,
    email,
    expiresAt: Date.now() + account.emailPinTtl * 60_000,
    attempts: 0,
    verified: false,
  };

  const template = player.server.emailTemplates.validation;
  const values = {
    name: username,
    code: pin,
    minutes: account.emailPinTtl,
    server: player.config.sln.serverName,
  };
  try {
    await player.server.mailer.send({
      to: email,
      toName: username,
      subject: renderTemplate(template.subject, values),
      text: renderTemplate(template.body, values),
    });
  } catch (err) {
    log.error({ player: player.id, err: String(err) }, 'failed to send validation email');
    if (player.closed) return;
    player.emailPin = null;
    sendAccountAccept(player, AccountValidationReply.Busy);
    return;
  }
  if (player.closed) return;

  log.info({ player: player.id, account: username }, 'validation email sent');
  sendAccountAccept(player, AccountValidationReply.Ok);
}

export function handleAccount(player: Player, action: number, reader: EoReader): Promise<void> | void {
  switch (action) {
    case PacketAction.Request:
      return accountRequest(player, reader);
    case PacketAction.Create:
      return accountCreate(player, reader);
    case PacketAction.Agree:
      return accountAgree(player, reader);
    case PacketAction.Accept:
      return accountAccept(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Account action');
  }
}
