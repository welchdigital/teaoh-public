import {
  AdminLevel,
  CharacterCreateClientPacket,
  CharacterPlayerServerPacket,
  CharacterRemoveClientPacket,
  CharacterReply,
  CharacterReplyServerPacket,
  CharacterRequestClientPacket,
  CharacterTakeClientPacket,
  EoReader,
  Gender,
  PacketAction,
} from 'eolib';
import { sql, type Kysely } from 'kysely';
import { countCharacters, getCharacterList } from '../../account/accounts.ts';
import { Character } from '../../character/character.ts';
import type { Config } from '../../config.ts';
import type { DB } from '../../db/schema.ts';
import { log } from '../../log.ts';
import { ensureGuildLeader } from '../../world/guilds.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';

type CharacterReplyData = CharacterReplyServerPacket['replyCodeData'];

function sendReply(player: Player, replyCode: number, data?: CharacterReplyData): void {
  const reply = new CharacterReplyServerPacket();
  reply.replyCode = replyCode;
  reply.replyCodeData = data ?? replyDataFor(replyCode);
  player.bus.send(reply);
}

function replyDataFor(replyCode: number): CharacterReplyData {
  switch (replyCode) {
    case CharacterReply.Exists:
      return new CharacterReplyServerPacket.ReplyCodeDataExists();
    case CharacterReply.Full:
      return new CharacterReplyServerPacket.ReplyCodeDataFull();
    case CharacterReply.NotApproved:
      return new CharacterReplyServerPacket.ReplyCodeDataNotApproved();
    default:
      return new CharacterReplyServerPacket.ReplyCodeDataDefault();
  }
}

function validateCharacterName(player: Player, name: string): boolean {
  const { minNameLength, maxNameLength } = player.config.character;
  return (
    name.length >= minNameLength && name.length <= maxNameLength && /^[a-z]+$/.test(name)
  );
}

function validAppearance(player: Player, create: CharacterCreateClientPacket): boolean {
  const { character } = player.config;
  return (
    (create.gender === Gender.Female || create.gender === Gender.Male) &&
    Number.isInteger(create.skin) &&
    create.skin >= 0 &&
    create.skin <= character.maxSkin &&
    create.hairColor >= 0 &&
    create.hairColor <= character.maxHairColor &&
    create.hairStyle >= 0 &&
    create.hairStyle <= character.maxHairStyle
  );
}

async function characterRequest(player: Player, reader: EoReader): Promise<void> {
  const request = CharacterRequestClientPacket.deserialize(reader);
  if (request.requestString !== 'NEW') return;
  if (player.state !== ClientState.LoggedIn) return;

  const count = await countCharacters(player.server.db, player.accountId);
  if (player.closed) return;

  if (count >= player.config.account.maxCharacters) {
    sendReply(player, CharacterReply.Full);
    return;
  }

  sendReply(player, player.generateSessionId(), new CharacterReplyServerPacket.ReplyCodeDataDefault());
}

async function characterCreate(player: Player, reader: EoReader): Promise<void> {
  const create = CharacterCreateClientPacket.deserialize(reader);
  if (player.state !== ClientState.LoggedIn) return;

  if (!validAppearance(player, create)) return;

  const sessionId = player.peekSessionId();
  if (sessionId === null) return;
  if (sessionId !== create.sessionId) {
    player.close(`wrong session id: got ${create.sessionId}, expected ${sessionId}`);
    return;
  }

  const name = create.name.toLowerCase();
  if (!validateCharacterName(player, name)) {
    sendReply(player, CharacterReply.NotApproved);
    return;
  }

  const { db } = player.server;
  const owned = await countCharacters(db, player.accountId);
  if (player.closed) return;
  if (owned >= player.config.account.maxCharacters) {
    sendReply(player, CharacterReply.Full);
    return;
  }

  const exists = await Character.exists(db, name);
  if (player.closed) return;
  if (exists) {
    sendReply(player, CharacterReply.Exists);
    return;
  }

  const { character: created, bootstrapAdmin } = await createNewCharacter(db, player.config, player.accountId, {
    name,
    gender: create.gender,
    hairStyle: create.hairStyle,
    hairColor: create.hairColor,
    skin: create.skin,
  });
  if (created === null) {
    player.close('error creating character');
    return;
  }

  if (bootstrapAdmin) {
    log.info(
      { player: player.id, character: name },
      'bootstrap character created as High Game Master',
    );
  } else {
    log.info({ player: player.id, character: name }, 'character created');
  }

  const characters = await getCharacterList(db, player.accountId, player.server.pubData);
  if (player.closed) return;
  const data = new CharacterReplyServerPacket.ReplyCodeDataOk();
  data.characters = characters;
  sendReply(player, CharacterReply.Ok, data);
}

const FIRST_CHARACTER_LOCK = 0x7465616f;

export interface NewCharacterDetails {
  name: string;
  gender: number;
  hairStyle: number;
  hairColor: number;
  skin: number;
}

export async function createNewCharacter(
  db: Kysely<DB>,
  config: Config,
  accountId: number,
  details: NewCharacterDetails,
): Promise<{ character: Character | null; bootstrapAdmin: boolean }> {
  const spawn = config.newCharacter;
  const create = (target: Kysely<DB>, admin: boolean) =>
    Character.create(target, accountId, {
      ...details,
      map: spawn.spawnMap,
      x: spawn.spawnX,
      y: spawn.spawnY,
      direction: spawn.spawnDirection,
      home: spawn.home,
      adminLevel: admin ? AdminLevel.HighGameMaster : AdminLevel.Player,
    });

  if (!config.character.firstCharacterAdmin || (await countCharacters(db)) > 0) {
    return { character: await create(db, false), bootstrapAdmin: false };
  }
  return db.transaction().execute(async (trx) => {
    if (config.database.driver === 'postgres') {
      await sql`SELECT pg_advisory_xact_lock(${FIRST_CHARACTER_LOCK})`.execute(trx);
    }
    const bootstrapAdmin = (await countCharacters(trx)) === 0;
    return { character: await create(trx, bootstrapAdmin), bootstrapAdmin };
  });
}

async function characterTake(player: Player, reader: EoReader): Promise<void> {
  const take = CharacterTakeClientPacket.deserialize(reader);
  if (player.state !== ClientState.LoggedIn) return;

  const character = await Character.load(player.server.db, take.characterId);
  if (player.closed) return;
  if (character === null || character.accountId !== player.accountId) {
    player.close(`invalid character delete request for id ${take.characterId}`);
    return;
  }

  const reply = new CharacterPlayerServerPacket();
  reply.sessionId = player.generateSessionId();
  reply.characterId = take.characterId;
  player.bus.send(reply);
}

async function characterRemove(player: Player, reader: EoReader): Promise<void> {
  const remove = CharacterRemoveClientPacket.deserialize(reader);
  if (player.state !== ClientState.LoggedIn) return;

  const sessionId = player.takeSessionId();
  if (sessionId === null || sessionId !== remove.sessionId) {
    player.close(`wrong session id: got ${remove.sessionId}, expected ${sessionId}`);
    return;
  }

  const character = await Character.load(player.server.db, remove.characterId);
  if (player.closed) return;
  if (character === null || character.accountId !== player.accountId) {
    player.close(`invalid character delete for id ${remove.characterId}`);
    return;
  }

  const guildId = character.row.guild_id;
  await character.delete(player.server.db);
  log.info({ player: player.id, character: character.name }, 'character deleted');
  if (guildId !== null) await ensureGuildLeader(player.server, guildId);
  if (player.closed) return;

  const characters = await getCharacterList(player.server.db, player.accountId, player.server.pubData);
  if (player.closed) return;
  const data = new CharacterReplyServerPacket.ReplyCodeDataDeleted();
  data.characters = characters;
  sendReply(player, CharacterReply.Deleted, data);
}

export function handleCharacter(
  player: Player,
  action: number,
  reader: EoReader,
): Promise<void> | void {
  switch (action) {
    case PacketAction.Request:
      return characterRequest(player, reader);
    case PacketAction.Create:
      return characterCreate(player, reader);
    case PacketAction.Take:
      return characterTake(player, reader);
    case PacketAction.Remove:
      return characterRemove(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Character action');
  }
}
