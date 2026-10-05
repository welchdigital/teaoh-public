import {
  decodeNumber,
  DropFile,
  DropNpcRecord,
  DropRecord,
  Ecf,
  EcfRecord,
  Eif,
  EifRecord,
  encodeNumber,
  Enf,
  EnfRecord,
  EoWriter,
  Esf,
  EsfRecord,
  InnFile,
  InnQuestionRecord,
  InnRecord,
  INT_MAX,
  ShopCraftIngredientRecord,
  ShopCraftRecord,
  ShopFile,
  ShopRecord,
  ShopTradeRecord,
  SkillMasterFile,
  SkillMasterRecord,
  SkillMasterSkillRecord,
  TalkFile,
  TalkMessageRecord,
  TalkRecord,
} from 'eolib';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.ts';

type Json = Record<string, unknown>;
type Serialize<T> = (writer: EoWriter, data: T) => void;

interface JsonEntry {
  path: string;
  value: Json | null;
  error: string | null;
}

interface PubBytes {
  bytes: Uint8Array;
  records: number;
}

export interface GeneratedPub {
  file: string;
  records: number;
}

const CKSUM_POLY = 0x04c11db7;
const PUB_HEADER_SIZE = 7;
const EOF_NAME = 'eof';

const CKSUM_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ CKSUM_POLY : crc << 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export function crc32Cksum(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    crc = ((crc << 8) ^ CKSUM_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function ridFromChecksum(checksum: number): [number, number] {
  const signed = checksum | 0;
  let value = signed >= 0 ? signed : signed === -0x80000000 ? -1 : -signed + 0x7fffffff;
  if (value < 0) return [0, 0];
  if (value >= INT_MAX) value %= INT_MAX;
  const encoded = encodeNumber(value);
  return [decodeNumber(encoded.subarray(0, 2)), decodeNumber(encoded.subarray(2, 4))];
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toInt(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function int(v: Json, ...keys: string[]): number {
  for (const key of keys) {
    if (v[key] !== undefined) return toInt(v[key]);
  }
  return 0;
}

function str(v: Json, key: string): string {
  const value = v[key];
  return typeof value === 'string' ? value : '';
}

function list(v: Json, key: string): unknown[] {
  const value = v[key];
  return Array.isArray(value) ? value : [];
}

function obj(value: unknown): Json {
  return isObject(value) ? value : {};
}

function fixed<T>(values: unknown[], length: number, key: string, make: (value: unknown) => T): T[] {
  if (values.length > length) {
    throw new Error(`${key}: expected at most ${length} entries, got ${values.length}`);
  }
  return Array.from({ length }, (_, i) => make(values[i]));
}

function byteOrder(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

function readJsonDir(dir: string): JsonEntry[] | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    log.warn({ dir, err: String(err) }, 'pub JSON directory not readable; keeping the existing pub file');
    return null;
  }
  const entries = names
    .filter((name) => name.endsWith('.json'))
    .sort(byteOrder)
    .map((name): JsonEntry => {
      const path = join(dir, name);
      try {
        const value: unknown = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
        if (!isObject(value)) throw new Error('expected a JSON object');
        return { path, value, error: null };
      } catch (err) {
        return { path, value: null, error: String(err) };
      }
    });
  if (!entries.some((entry) => entry.value !== null)) {
    for (const entry of entries) log.warn({ path: entry.path, err: entry.error }, 'invalid pub JSON file skipped');
    log.warn({ dir }, 'no usable pub JSON files; keeping the existing pub file');
    return null;
  }
  return entries;
}

function tryBuild<T>(path: string, build: () => T, serialize: Serialize<T>, message: string): T | null {
  try {
    const record = build();
    serialize(new EoWriter(), record);
    return record;
  } catch (err) {
    log.warn({ path, err: String(err) }, message);
    return null;
  }
}

function indexedRecord<T>(entry: JsonEntry, build: (v: Json) => T, serialize: Serialize<T>): T | null {
  const message = 'invalid pub JSON file replaced by an empty record';
  const value = entry.value;
  if (value === null) {
    log.warn({ path: entry.path, err: entry.error }, message);
    return null;
  }
  return tryBuild(entry.path, () => build(value), serialize, message);
}

function keyedRecords<T>(entries: JsonEntry[], build: (v: Json) => T, serialize: Serialize<T>): T[] {
  const message = 'invalid pub JSON file skipped';
  const records: T[] = [];
  for (const entry of entries) {
    const value = entry.value;
    if (value === null) {
      log.warn({ path: entry.path, err: entry.error }, message);
      continue;
    }
    const record = tryBuild(entry.path, () => build(value), serialize, message);
    if (record !== null) records.push(record);
  }
  return records;
}

function indexedRecords<T extends { name: string }>(
  entries: JsonEntry[],
  build: (v: Json) => T,
  serialize: Serialize<T>,
): T[] {
  const records = entries.map((entry) => indexedRecord(entry, build, serialize) ?? build({}));
  return [...records, build({ name: EOF_NAME })];
}

function serializePub<T>(file: T, serialize: Serialize<T>): Uint8Array {
  const writer = new EoWriter();
  serialize(writer, file);
  return writer.toByteArray();
}

function serializeClientPub<T extends { rid: number[] }>(file: T, serialize: Serialize<T>): Uint8Array {
  file.rid = [0, 0];
  const unsigned = serializePub(file, serialize);
  file.rid = ridFromChecksum(crc32Cksum(unsigned.subarray(PUB_HEADER_SIZE)));
  return serializePub(file, serialize);
}

function classRecord(v: Json): EcfRecord {
  const record = new EcfRecord();
  record.name = str(v, 'name');
  record.parentType = int(v, 'parent');
  record.statGroup = int(v, 'stat_group');
  record.str = int(v, 'str');
  record.intl = int(v, 'intl');
  record.wis = int(v, 'wis');
  record.agi = int(v, 'agi');
  record.con = int(v, 'con');
  record.cha = int(v, 'cha');
  return record;
}

function itemRecord(v: Json): EifRecord {
  const record = new EifRecord();
  record.name = str(v, 'name');
  record.graphicId = int(v, 'graphic_id');
  record.type = int(v, 'type');
  record.subtype = int(v, 'subtype');
  record.special = int(v, 'special');
  record.hp = int(v, 'hp');
  record.tp = int(v, 'tp');
  record.minDamage = int(v, 'min_damage');
  record.maxDamage = int(v, 'max_damage');
  record.accuracy = int(v, 'accuracy');
  record.evade = int(v, 'evade');
  record.armor = int(v, 'armor');
  record.returnDamage = int(v, 'return_damage');
  record.str = int(v, 'str');
  record.intl = int(v, 'intl');
  record.wis = int(v, 'wis');
  record.agi = int(v, 'agi');
  record.con = int(v, 'con');
  record.cha = int(v, 'cha');
  record.lightResistance = int(v, 'light_resistance');
  record.darkResistance = int(v, 'dark_resistance');
  record.earthResistance = int(v, 'earth_resistance');
  record.airResistance = int(v, 'air_resistance');
  record.waterResistance = int(v, 'water_resistance');
  record.fireResistance = int(v, 'fire_resistance');
  record.spec1 = int(v, 'spec1');
  record.spec2 = int(v, 'spec2');
  record.spec3 = int(v, 'spec3');
  record.levelRequirement = int(v, 'level_requirement');
  record.classRequirement = int(v, 'class_requirement');
  record.strRequirement = int(v, 'str_requirement');
  record.intRequirement = int(v, 'int_requirement');
  record.wisRequirement = int(v, 'wis_requirement');
  record.agiRequirement = int(v, 'agi_requirement');
  record.conRequirement = int(v, 'con_requirement');
  record.chaRequirement = int(v, 'cha_requirement');
  record.element = int(v, 'element');
  record.elementDamage = int(v, 'element_damage', 'element_ramage');
  record.weight = int(v, 'weight');
  record.size = int(v, 'size');
  return record;
}

function npcRecord(v: Json): EnfRecord {
  const record = new EnfRecord();
  record.name = str(v, 'name');
  record.graphicId = int(v, 'graphic_id');
  record.race = int(v, 'race');
  record.boss = v['boss'] === true;
  record.child = v['child'] === true;
  record.type = int(v, 'type');
  record.behaviorId = int(v, 'behavior_id');
  record.hp = int(v, 'hp');
  record.tp = int(v, 'tp');
  record.minDamage = int(v, 'min_damage');
  record.maxDamage = int(v, 'max_damage');
  record.accuracy = int(v, 'accuracy');
  record.evade = int(v, 'evade');
  record.armor = int(v, 'armor');
  record.returnDamage = int(v, 'return_damage');
  record.element = int(v, 'element');
  record.elementDamage = int(v, 'element_damage');
  record.elementWeakness = int(v, 'element_weakness');
  record.elementWeaknessDamage = int(v, 'element_weakness_damage');
  record.level = int(v, 'level');
  record.experience = int(v, 'experience');
  return record;
}

function spellRecord(v: Json): EsfRecord {
  const record = new EsfRecord();
  record.name = str(v, 'name');
  record.chant = str(v, 'chant');
  record.iconId = int(v, 'icon_id');
  record.graphicId = int(v, 'graphic_id');
  record.tpCost = int(v, 'tp_cost');
  record.spCost = int(v, 'sp_cost');
  record.castTime = int(v, 'cast_time');
  record.nature = int(v, 'nature');
  record.type = int(v, 'type');
  record.element = int(v, 'element');
  record.elementPower = int(v, 'element_power');
  record.targetRestrict = int(v, 'target_restrict');
  record.targetType = int(v, 'target_type');
  record.targetTime = int(v, 'target_time');
  record.maxSkillLevel = int(v, 'max_skill_level');
  record.minDamage = int(v, 'min_damage');
  record.maxDamage = int(v, 'max_damage');
  record.accuracy = int(v, 'accuracy');
  record.evade = int(v, 'evade');
  record.armor = int(v, 'armor');
  record.returnDamage = int(v, 'return_damage');
  record.hpHeal = int(v, 'heal_hp', 'hp_heal');
  record.tpHeal = int(v, 'heal_tp', 'tp_heal');
  record.spHeal = int(v, 'heal_sp', 'sp_heal');
  record.str = int(v, 'str');
  record.intl = int(v, 'intl');
  record.wis = int(v, 'wis');
  record.agi = int(v, 'agi');
  record.con = int(v, 'con');
  record.cha = int(v, 'cha');
  return record;
}

function dropRecord(npcId: number, v: Json): DropNpcRecord {
  const record = new DropNpcRecord();
  record.npcId = npcId;
  record.drops = list(v, 'drops').map((entry) => {
    const d = obj(entry);
    const drop = new DropRecord();
    drop.itemId = int(d, 'item_id');
    drop.minAmount = int(d, 'min_amount');
    drop.maxAmount = int(d, 'max_amount');
    drop.rate = int(d, 'rate');
    return drop;
  });
  return record;
}

function talkRecord(npcId: number, v: Json): TalkRecord {
  const record = new TalkRecord();
  record.npcId = npcId;
  record.rate = int(v, 'talk_rate');
  record.messages = list(v, 'talk_messages').map((entry) => {
    const message = new TalkMessageRecord();
    message.message = typeof entry === 'string' ? entry : str(obj(entry), 'message');
    return message;
  });
  return record;
}

function shopRecord(v: Json): ShopRecord {
  const record = new ShopRecord();
  record.behaviorId = int(v, 'behavior_id');
  record.name = str(v, 'name');
  record.minLevel = int(v, 'min_level', 'minLevel');
  record.maxLevel = int(v, 'max_level', 'maxLevel');
  record.classRequirement = int(v, 'class_requirement');
  record.trades = list(v, 'trades').map((entry) => {
    const t = obj(entry);
    const trade = new ShopTradeRecord();
    trade.itemId = int(t, 'item_id');
    trade.buyPrice = int(t, 'buy_price');
    trade.sellPrice = int(t, 'sell_price');
    trade.maxAmount = int(t, 'max_amount');
    return trade;
  });
  record.crafts = list(v, 'crafts').map((entry) => {
    const c = obj(entry);
    const craft = new ShopCraftRecord();
    craft.itemId = int(c, 'itemId', 'item_id');
    craft.ingredients = fixed(list(c, 'ingredients'), 4, 'ingredients', (value) => {
      const i = obj(value);
      const ingredient = new ShopCraftIngredientRecord();
      ingredient.itemId = int(i, 'item_id');
      ingredient.amount = int(i, 'amount');
      return ingredient;
    });
    return craft;
  });
  return record;
}

function innRecord(v: Json): InnRecord {
  const record = new InnRecord();
  record.behaviorId = int(v, 'behavior_id');
  record.name = str(v, 'name');
  record.spawnMap = int(v, 'spawn_map');
  record.spawnX = int(v, 'spawn_x');
  record.spawnY = int(v, 'spawn_y');
  record.sleepMap = int(v, 'sleep_map');
  record.sleepX = int(v, 'sleep_x');
  record.sleepY = int(v, 'sleep_y');
  record.alternateSpawnEnabled = v['alternate_spawn_enabled'] === true;
  record.alternateSpawnMap = int(v, 'alternate_spawn_map');
  record.alternateSpawnX = int(v, 'alternate_spawn_x');
  record.alternateSpawnY = int(v, 'alternate_spawn_y');
  record.questions = fixed(list(v, 'questions'), 3, 'questions', (value) => {
    const q = obj(value);
    const question = new InnQuestionRecord();
    question.question = str(q, 'question');
    question.answer = str(q, 'answer');
    return question;
  });
  return record;
}

function skillMasterRecord(v: Json): SkillMasterRecord {
  const record = new SkillMasterRecord();
  record.behaviorId = int(v, 'behavior_id');
  record.name = str(v, 'name');
  record.minLevel = int(v, 'min_level', 'minLevel');
  record.maxLevel = int(v, 'max_level', 'maxLevel');
  record.classRequirement = int(v, 'class_requirement');
  record.skills = list(v, 'skills').map((entry) => {
    const s = obj(entry);
    const skill = new SkillMasterSkillRecord();
    skill.skillId = int(s, 'id');
    skill.levelRequirement = int(s, 'level_requirement');
    skill.classRequirement = int(s, 'class_requirement');
    skill.price = int(s, 'price');
    skill.skillRequirements = fixed(list(s, 'skill_requirements'), 4, 'skill_requirements', toInt);
    skill.strRequirement = int(s, 'str_requirement');
    skill.intRequirement = int(s, 'int_requirement');
    skill.wisRequirement = int(s, 'wis_requirement');
    skill.agiRequirement = int(s, 'agi_requirement');
    skill.conRequirement = int(s, 'con_requirement');
    skill.chaRequirement = int(s, 'cha_requirement');
    return skill;
  });
  return record;
}

function generateClasses(entries: JsonEntry[]): PubBytes {
  const file = new Ecf();
  file.classes = indexedRecords(entries, classRecord, EcfRecord.serialize);
  file.totalClassesCount = file.classes.length;
  file.version = 0;
  return { bytes: serializeClientPub(file, Ecf.serialize), records: file.classes.length };
}

function generateItems(entries: JsonEntry[]): PubBytes {
  const file = new Eif();
  file.items = indexedRecords(entries, itemRecord, EifRecord.serialize);
  file.totalItemsCount = file.items.length;
  file.version = 0;
  return { bytes: serializeClientPub(file, Eif.serialize), records: file.items.length };
}

function generateSpells(entries: JsonEntry[]): PubBytes {
  const file = new Esf();
  file.skills = indexedRecords(entries, spellRecord, EsfRecord.serialize);
  file.totalSkillsCount = file.skills.length;
  file.version = 0;
  return { bytes: serializeClientPub(file, Esf.serialize), records: file.skills.length };
}

function generateNpcs(entries: JsonEntry[]): { enf: PubBytes; drops: PubBytes; talk: PubBytes } {
  const enf = new Enf();
  const dropFile = new DropFile();
  const talkFile = new TalkFile();
  enf.npcs = [];
  dropFile.npcs = [];
  talkFile.npcs = [];
  entries.forEach((entry, i) => {
    const npcId = i + 1;
    const record = indexedRecord(entry, npcRecord, EnfRecord.serialize);
    enf.npcs.push(record ?? npcRecord({}));
    const value = entry.value;
    if (record === null || value === null) return;
    if (list(value, 'drops').length > 0) {
      const drops = tryBuild(entry.path, () => dropRecord(npcId, value), DropNpcRecord.serialize, 'invalid NPC drops skipped');
      if (drops !== null) dropFile.npcs.push(drops);
    }
    if (list(value, 'talk_messages').length > 0) {
      const talk = tryBuild(entry.path, () => talkRecord(npcId, value), TalkRecord.serialize, 'invalid NPC speech skipped');
      if (talk !== null) talkFile.npcs.push(talk);
    }
  });
  enf.npcs.push(npcRecord({ name: EOF_NAME }));
  enf.totalNpcsCount = enf.npcs.length;
  enf.version = 0;
  return {
    enf: { bytes: serializeClientPub(enf, Enf.serialize), records: enf.npcs.length },
    drops: { bytes: serializePub(dropFile, DropFile.serialize), records: dropFile.npcs.length },
    talk: { bytes: serializePub(talkFile, TalkFile.serialize), records: talkFile.npcs.length },
  };
}

function generateShops(entries: JsonEntry[]): PubBytes {
  const file = new ShopFile();
  file.shops = keyedRecords(entries, shopRecord, ShopRecord.serialize);
  return { bytes: serializePub(file, ShopFile.serialize), records: file.shops.length };
}

function generateInns(entries: JsonEntry[]): PubBytes {
  const file = new InnFile();
  file.inns = keyedRecords(entries, innRecord, InnRecord.serialize);
  return { bytes: serializePub(file, InnFile.serialize), records: file.inns.length };
}

function generateSkillMasters(entries: JsonEntry[]): PubBytes {
  const file = new SkillMasterFile();
  file.skillMasters = keyedRecords(entries, skillMasterRecord, SkillMasterRecord.serialize);
  return { bytes: serializePub(file, SkillMasterFile.serialize), records: file.skillMasters.length };
}

function writePub(outDir: string, file: string, pub: PubBytes, out: GeneratedPub[]): void {
  const path = join(outDir, file);
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, pub.bytes);
    renameSync(temp, path);
    out.push({ file, records: pub.records });
    log.info({ path, records: pub.records }, 'pub file generated from JSON');
  } catch (err) {
    log.warn({ path, err: String(err) }, 'generated pub file not written');
  }
}

export function generatePubs(dataDir: string, outDir: string = join(dataDir, 'pub')): GeneratedPub[] {
  const jsonDir = join(dataDir, 'pub');
  const generated: GeneratedPub[] = [];
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    log.warn({ path: outDir, err: String(err) }, 'pub output directory not created');
    return generated;
  }
  const generate = (name: string, build: (entries: JsonEntry[]) => Array<[string, PubBytes]>): void => {
    const dir = join(jsonDir, name);
    const entries = readJsonDir(dir);
    if (entries === null) return;
    let files: Array<[string, PubBytes]>;
    try {
      files = build(entries);
    } catch (err) {
      log.warn({ dir, err: String(err) }, 'pub generation failed; keeping the existing pub file');
      return;
    }
    for (const [file, pub] of files) writePub(outDir, file, pub, generated);
  };

  generate('classes', (entries) => [['dat001.ecf', generateClasses(entries)]]);
  generate('items', (entries) => [['dat001.eif', generateItems(entries)]]);
  generate('spells', (entries) => [['dsl001.esf', generateSpells(entries)]]);
  generate('npcs', (entries) => {
    const { enf, drops, talk } = generateNpcs(entries);
    return [
      ['dtn001.enf', enf],
      ['dtd001.edf', drops],
      ['ttd001.etf', talk],
    ];
  });
  generate('shops', (entries) => [['dts001.esf', generateShops(entries)]]);
  generate('inns', (entries) => [['din001.eid', generateInns(entries)]]);
  generate('skill_masters', (entries) => [['dsm001.emf', generateSkillMasters(entries)]]);
  return generated;
}
