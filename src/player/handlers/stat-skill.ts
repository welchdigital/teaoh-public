import {
  CharacterStatsUpdate,
  EoReader,
  NpcType,
  PacketAction,
  SkillLearn,
  SkillMasterReply,
  SkillStatRequirements,
  Spell,
  StatId,
  StatSkillAcceptServerPacket,
  StatSkillAddClientPacket,
  StatSkillJunkClientPacket,
  StatSkillJunkServerPacket,
  StatSkillOpenClientPacket,
  StatSkillOpenServerPacket,
  StatSkillPlayerServerPacket,
  StatSkillRemoveClientPacket,
  StatSkillRemoveServerPacket,
  StatSkillReplyServerPacket,
  StatSkillTakeClientPacket,
  StatSkillTakeServerPacket,
  TrainType,
} from 'eolib';
import { GOLD_ITEM, MAX_STAT } from '../../constants.ts';
import { log } from '../../log.ts';
import { inClientRange } from '../../world/coords.ts';
import { broadcastPartyHp } from '../../world/map/party-hp.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';
import { isTrading } from './trade.ts';

function masterFor(player: Player) {
  if (player.skillMasterId === null || player.interactNpcIndex === null || player.map === null) {
    return undefined;
  }
  const npc = player.map.npcs.get(player.interactNpcIndex);
  if (npc === undefined || npc.data.type !== NpcType.Trainer || npc.data.behaviorId !== player.skillMasterId) {
    return undefined;
  }
  return player.server.pubData.skillMasters?.skillMasters.find(
    (m) => m.behaviorId === player.skillMasterId,
  );
}

function recalculateStats(player: Player): void {
  const character = player.character!;
  const hp = character.row.hp;
  const maxHp = character.maxHp;
  character.calculateStats(player.server.formulas, player.server.pubData, player.config.combat);
  if (player.map !== null && (character.row.hp !== hp || character.maxHp !== maxHp)) {
    broadcastPartyHp(player.map, character);
  }
}

function statsUpdate(player: Player): CharacterStatsUpdate {
  return player.character!.statsUpdate(player.server.pubData);
}

function open(player: Player, reader: EoReader): void {
  const packet = StatSkillOpenClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.generateSessionId();

  const npc = player.map!.npcs.get(packet.npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Trainer) return;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return;

  const master = player.server.pubData.skillMasters?.skillMasters.find(
    (m) => m.behaviorId === npc.data.behaviorId,
  );
  if (master === undefined) return;
  if (master.minLevel > 0 && character.row.level < master.minLevel) return;
  if (master.maxLevel > 0 && character.row.level > master.maxLevel) return;

  player.skillMasterId = master.behaviorId;
  player.interactNpcIndex = packet.npcIndex;
  const reply = new StatSkillOpenServerPacket();
  reply.sessionId = sessionId;
  reply.shopName = master.name;
  reply.skills = master.skills.map((skill) => {
    const learn = new SkillLearn();
    learn.id = skill.skillId;
    learn.levelRequirement = skill.levelRequirement;
    learn.classRequirement = skill.classRequirement;
    learn.cost = skill.price;
    learn.skillRequirements = skill.skillRequirements;
    const requirements = new SkillStatRequirements();
    requirements.str = skill.strRequirement;
    requirements.intl = skill.intRequirement;
    requirements.wis = skill.wisRequirement;
    requirements.agi = skill.agiRequirement;
    requirements.con = skill.conRequirement;
    requirements.cha = skill.chaRequirement;
    learn.statRequirements = requirements;
    return learn;
  });
  player.bus.send(reply);
}

function take(player: Player, reader: EoReader): void {
  const packet = StatSkillTakeClientPacket.deserialize(reader);
  if (!inGame(player) || isTrading(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;

  const master = masterFor(player);
  const skill = master?.skills.find((s) => s.skillId === packet.spellId);
  if (master === undefined || skill === undefined) return;

  const character = player.character!;
  if (character.spells.some((s) => s.id === skill.skillId)) return;

  const adjusted = character.adjustedStats;
  if (
    character.row.level < skill.levelRequirement ||
    adjusted.str < skill.strRequirement ||
    adjusted.int < skill.intRequirement ||
    adjusted.wis < skill.wisRequirement ||
    adjusted.agi < skill.agiRequirement ||
    adjusted.con < skill.conRequirement ||
    adjusted.cha < skill.chaRequirement ||
    character.heldAmount(GOLD_ITEM) < skill.price
  ) {
    return;
  }
  for (const required of skill.skillRequirements) {
    if (required > 0 && !character.spells.some((s) => s.id === required)) return;
  }

  if (skill.classRequirement !== 0 && skill.classRequirement !== character.row.class) {
    const reply = new StatSkillReplyServerPacket();
    reply.replyCode = SkillMasterReply.WrongClass;
    const data = new StatSkillReplyServerPacket.ReplyCodeDataWrongClass();
    data.classId = skill.classRequirement;
    reply.replyCodeData = data;
    player.bus.send(reply);
    return;
  }

  character.removeItem(GOLD_ITEM, skill.price);
  const spell = new Spell();
  spell.id = skill.skillId;
  spell.level = 1;
  character.spells.push(spell);

  const reply = new StatSkillTakeServerPacket();
  reply.spellId = skill.skillId;
  reply.goldAmount = character.heldAmount(GOLD_ITEM);
  player.bus.send(reply);
}

function remove(player: Player, reader: EoReader): void {
  const packet = StatSkillRemoveClientPacket.deserialize(reader);
  if (!inGame(player) || masterFor(player) === undefined) return;
  if (player.peekSessionId() !== packet.sessionId) return;

  const character = player.character!;
  const before = character.spells.length;
  character.spells = character.spells.filter((s) => s.id !== packet.spellId);
  if (character.spells.length === before) return;

  const reply = new StatSkillRemoveServerPacket();
  reply.spellId = packet.spellId;
  player.bus.send(reply);
}

function add(player: Player, reader: EoReader): void {
  const packet = StatSkillAddClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;

  if (packet.actionType === TrainType.Stat) {
    if (character.row.stat_points <= 0) return;
    const data = packet.actionTypeData;
    if (!(data instanceof StatSkillAddClientPacket.ActionTypeDataStat)) return;
    const column = STAT_COLUMNS[data.statId];
    if (column === undefined || character.row[column] >= MAX_STAT) return;
    character.row[column]++;
    character.row.stat_points--;
    recalculateStats(player);

    const reply = new StatSkillPlayerServerPacket();
    reply.statPoints = character.row.stat_points;
    reply.stats = statsUpdate(player);
    player.bus.send(reply);
    return;
  }

  if (packet.actionType === TrainType.Skill) {
    if (character.row.skill_points <= 0) return;
    const data = packet.actionTypeData;
    if (!(data instanceof StatSkillAddClientPacket.ActionTypeDataSkill)) return;
    const spell = character.spells.find((s) => s.id === data.spellId);
    const record = player.server.pubData.esf?.parsed.skills[data.spellId - 1];
    if (spell === undefined || record === undefined) return;
    if (record.maxSkillLevel > 0 && spell.level >= record.maxSkillLevel) return;
    spell.level++;
    character.row.skill_points--;

    const reply = new StatSkillAcceptServerPacket();
    reply.skillPoints = character.row.skill_points;
    const updated = new Spell();
    updated.id = spell.id;
    updated.level = spell.level;
    reply.spell = updated;
    player.bus.send(reply);
  }
}

function junk(player: Player, reader: EoReader): void {
  const packet = StatSkillJunkClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  if (player.peekSessionId() !== packet.sessionId) return;
  if (masterFor(player) === undefined) return;

  const character = player.character!;
  character.row.strength = 0;
  character.row.intelligence = 0;
  character.row.wisdom = 0;
  character.row.agility = 0;
  character.row.constitution = 0;
  character.row.charisma = 0;
  character.row.stat_points = character.row.level * player.config.world.statPointsPerLevel;
  character.row.skill_points = character.row.level * player.config.world.skillPointsPerLevel;
  character.spells.length = 0;
  recalculateStats(player);

  const reply = new StatSkillJunkServerPacket();
  reply.stats = character.statsReset();
  player.bus.send(reply);
}

const STAT_COLUMNS: Record<
  number,
  'strength' | 'intelligence' | 'wisdom' | 'agility' | 'constitution' | 'charisma' | undefined
> = {
  [StatId.Str]: 'strength',
  [StatId.Int]: 'intelligence',
  [StatId.Wis]: 'wisdom',
  [StatId.Agi]: 'agility',
  [StatId.Con]: 'constitution',
  [StatId.Cha]: 'charisma',
};

export function handleStatSkill(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Open:
      open(player, reader);
      break;
    case PacketAction.Take:
      take(player, reader);
      break;
    case PacketAction.Remove:
      remove(player, reader);
      break;
    case PacketAction.Add:
      add(player, reader);
      break;
    case PacketAction.Junk:
      junk(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled StatSkill action');
  }
}
