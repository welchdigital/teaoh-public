import {
  AccountCreateClientPacket,
  AvatarChange,
  CharacterStatsEquipmentChange,
  LoginReplyServerPacket,
  LoginRequestClientPacket,
  PacketAction,
  PacketFamily,
} from 'eolib';
import type { EoReader, EoWriter } from 'eolib';

export const ACTION_CONFIG = 220;
export const ACTION_SWAP = 35;
export const FAMILY_BOSS = 52;
export const FAMILY_CAPTCHA = 249;
export const ACCOUNT_REPLY_WRONG_PIN = 8;

function readChunked<T>(reader: EoReader, read: () => T): T {
  const previous = reader.chunkedReadingMode;
  reader.chunkedReadingMode = true;
  try {
    return read();
  } finally {
    reader.chunkedReadingMode = previous;
  }
}

export class CaptchaOpenServerPacket {
  id = 1;
  rewardExp = 0;
  captcha: string | null = null;

  readonly family = FAMILY_CAPTCHA;
  readonly action = PacketAction.Open;

  serialize(writer: EoWriter): void {
    writer.addShort(this.id);
    writer.addThree(this.rewardExp);
    if (this.captcha !== null) {
      writer.addByte(0xff);
      writer.addString(this.captcha);
    }
  }
}

export class CaptchaAgreeServerPacket {
  id = 1;
  captcha = '';

  readonly family = FAMILY_CAPTCHA;
  readonly action = PacketAction.Agree;

  serialize(writer: EoWriter): void {
    writer.addShort(this.id);
    writer.addString(this.captcha);
  }
}

export class CaptchaCloseServerPacket {
  experience = 0;

  readonly family = FAMILY_CAPTCHA;
  readonly action = PacketAction.Close;

  serialize(writer: EoWriter): void {
    writer.addInt(this.experience);
  }
}

export class CaptchaReplyClientPacket {
  id = 0;
  captcha = '';

  static deserialize(reader: EoReader): CaptchaReplyClientPacket {
    const packet = new CaptchaReplyClientPacket();
    packet.id = reader.getShort();
    packet.captcha = reader.getString();
    return packet;
  }
}

export class CaptchaRequestClientPacket {
  id = 0;

  static deserialize(reader: EoReader): CaptchaRequestClientPacket {
    const packet = new CaptchaRequestClientPacket();
    packet.id = reader.getShort();
    return packet;
  }
}

export class PaperdollSwapServerPacket {
  change: AvatarChange;
  itemId = 0;
  remainingAmount = 0;
  removedItemId = 0;
  removedItemAmount = 0;
  stats: CharacterStatsEquipmentChange;

  readonly family = PacketFamily.Paperdoll;
  readonly action = ACTION_SWAP;

  constructor(change: AvatarChange, stats: CharacterStatsEquipmentChange) {
    this.change = change;
    this.stats = stats;
  }

  serialize(writer: EoWriter): void {
    AvatarChange.serialize(writer, this.change);
    writer.addShort(this.itemId);
    writer.addThree(this.remainingAmount);
    writer.addChar(0);
    writer.addShort(this.removedItemId);
    writer.addThree(this.removedItemAmount);
    CharacterStatsEquipmentChange.serialize(writer, this.stats);
  }
}

export class BossPingServerPacket {
  npcIndex = 0;
  npcId = 0;
  hp = 0;
  hpPercentage = 0;
  killed = false;

  readonly family = FAMILY_BOSS;
  readonly action = PacketAction.Ping;

  serialize(writer: EoWriter): void {
    writer.addShort(this.npcIndex);
    writer.addShort(this.npcId);
    writer.addThree(this.hp);
    writer.addChar(this.hpPercentage);
    writer.addChar(this.killed ? 1 : 0);
  }
}

export const AccountRecoverReply = {
  AccountNotFound: 0,
  RequestAccepted: 1,
  RequestAcceptedShowEmail: 2,
  TooManyAttempts: 3,
  RecoveryDisabled: 4,
  Busy: 5,
  TooManyEmails: 6,
} as const;
export type AccountRecoverReply = (typeof AccountRecoverReply)[keyof typeof AccountRecoverReply];

export const AccountValidationReply = {
  Busy: 0,
  Ok: 1,
  TooManyAttempts: 2,
} as const;
export type AccountValidationReply =
  (typeof AccountValidationReply)[keyof typeof AccountValidationReply];

export const AccountRecoverPinReply = {
  WrongPin: 0,
  Ok: 1,
} as const;
export type AccountRecoverPinReply =
  (typeof AccountRecoverPinReply)[keyof typeof AccountRecoverPinReply];

export const AccountRecoverUpdateReply = {
  Error: 0,
  Ok: 1,
} as const;
export type AccountRecoverUpdateReply =
  (typeof AccountRecoverUpdateReply)[keyof typeof AccountRecoverUpdateReply];

export class AccountConfigServerPacket {
  delayTime = 0;
  emailValidation = false;

  readonly family = PacketFamily.Account;
  readonly action = ACTION_CONFIG;

  serialize(writer: EoWriter): void {
    writer.addShort(this.delayTime);
    writer.addChar(this.emailValidation ? 1 : 0);
  }
}

export class AccountAcceptClientPacket {
  sequenceNumber = 0;
  accountName = '';
  emailAddress = '';

  static deserialize(reader: EoReader): AccountAcceptClientPacket {
    const packet = new AccountAcceptClientPacket();
    readChunked(reader, () => {
      packet.sequenceNumber = reader.getShort();
      reader.nextChunk();
      packet.accountName = reader.getString();
      reader.nextChunk();
      packet.emailAddress = reader.getString();
    });
    return packet;
  }
}

export class AccountAcceptServerPacket {
  replyCode: AccountValidationReply = AccountValidationReply.Busy;

  readonly family = PacketFamily.Account;
  readonly action = PacketAction.Accept;

  serialize(writer: EoWriter): void {
    writer.addShort(this.replyCode);
  }
}

export class DeepAccountCreateClientPacket {
  create: AccountCreateClientPacket;
  pin: string | null;

  constructor(create: AccountCreateClientPacket, pin: string | null) {
    this.create = create;
    this.pin = pin;
  }

  static deserialize(reader: EoReader): DeepAccountCreateClientPacket {
    const create = AccountCreateClientPacket.deserialize(reader);
    const pin = reader.remaining > 0 ? readChunked(reader, () => reader.getString()) : null;
    return new DeepAccountCreateClientPacket(create, pin);
  }
}

export class DeepLoginRequestClientPacket {
  request: LoginRequestClientPacket;
  rememberMe: boolean;

  constructor(request: LoginRequestClientPacket, rememberMe: boolean) {
    this.request = request;
    this.rememberMe = rememberMe;
  }

  static deserialize(reader: EoReader): DeepLoginRequestClientPacket {
    const request = LoginRequestClientPacket.deserialize(reader);
    const rememberMe = reader.remaining > 0 && reader.getChar() === 1;
    return new DeepLoginRequestClientPacket(request, rememberMe);
  }
}

export class DeepLoginReplyServerPacket {
  reply: LoginReplyServerPacket;
  sessionToken: string | null;

  constructor(reply: LoginReplyServerPacket, sessionToken: string | null) {
    this.reply = reply;
    this.sessionToken = sessionToken;
  }

  get family(): number {
    return this.reply.family;
  }

  get action(): number {
    return this.reply.action;
  }

  serialize(writer: EoWriter): void {
    this.reply.serialize(writer);
    if (this.sessionToken !== null) writer.addString(this.sessionToken);
  }
}

export class LoginUseClientPacket {
  token = '';

  static deserialize(reader: EoReader): LoginUseClientPacket {
    const packet = new LoginUseClientPacket();
    packet.token = reader.getString();
    return packet;
  }
}

export class LoginConfigServerPacket {
  maxSkins = 0;
  maxHairModels = 0;
  maxCharacterName = 0;

  readonly family = PacketFamily.Login;
  readonly action = ACTION_CONFIG;

  serialize(writer: EoWriter): void {
    writer.addShort(this.maxSkins);
    writer.addShort(this.maxHairModels);
    writer.addChar(this.maxCharacterName);
  }
}

export class LoginTakeClientPacket {
  static deserialize(reader: EoReader): LoginTakeClientPacket {
    if (reader.remaining > 0) reader.getByte();
    return new LoginTakeClientPacket();
  }
}

export class LoginTakeServerPacket {
  replyCode: AccountRecoverReply = AccountRecoverReply.RecoveryDisabled;

  readonly family = PacketFamily.Login;
  readonly action = PacketAction.Take;

  serialize(writer: EoWriter): void {
    writer.addShort(this.replyCode);
  }
}

export class LoginCreateClientPacket {
  accountName = '';

  static deserialize(reader: EoReader): LoginCreateClientPacket {
    const packet = new LoginCreateClientPacket();
    packet.accountName = reader.getString();
    return packet;
  }
}

export class LoginCreateServerPacket {
  replyCode: AccountRecoverReply = AccountRecoverReply.AccountNotFound;
  emailAddress: string | null = null;

  readonly family = PacketFamily.Login;
  readonly action = PacketAction.Create;

  serialize(writer: EoWriter): void {
    writer.addShort(this.replyCode);
    if (this.emailAddress !== null) {
      writer.addByte(0xff);
      writer.addString(this.emailAddress);
    }
  }
}

export class LoginAcceptClientPacket {
  pin = '';

  static deserialize(reader: EoReader): LoginAcceptClientPacket {
    const packet = new LoginAcceptClientPacket();
    packet.pin = reader.getString();
    return packet;
  }
}

export class LoginAcceptServerPacket {
  replyCode: AccountRecoverPinReply = AccountRecoverPinReply.WrongPin;

  readonly family = PacketFamily.Login;
  readonly action = PacketAction.Accept;

  serialize(writer: EoWriter): void {
    writer.addShort(this.replyCode);
  }
}

export class LoginAgreeClientPacket {
  accountName = '';
  pin = '';
  password = '';

  static deserialize(reader: EoReader): LoginAgreeClientPacket {
    const packet = new LoginAgreeClientPacket();
    readChunked(reader, () => {
      packet.accountName = reader.getString();
      reader.nextChunk();
      packet.pin = reader.getString();
      reader.nextChunk();
      packet.password = reader.getString();
    });
    return packet;
  }
}

export class LoginAgreeServerPacket {
  replyCode: AccountRecoverUpdateReply = AccountRecoverUpdateReply.Error;

  readonly family = PacketFamily.Login;
  readonly action = PacketAction.Agree;

  serialize(writer: EoWriter): void {
    writer.addShort(this.replyCode);
  }
}
