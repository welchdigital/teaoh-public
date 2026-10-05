import {
  BigCoords,
  CharacterBaseStats,
  CharacterBaseStatsWelcome,
  CharacterMapInfo,
  CharacterSecondaryStats,
  CharacterStatsReset,
  CharacterStatsEquipmentChange,
  CharacterStatsUpdate,
  CharacterStatsWelcome,
  Coords,
  EquipmentChange,
  EquipmentMapInfo,
  EquipmentPaperdoll,
  EquipmentWelcome,
  Item,
  ItemSpecial,
  ItemType,
  Spell,
  Weight,
} from 'eolib';
import type { Kysely, Selectable, Transaction } from 'kysely';
import type { CombatConfig } from '../config.ts';
import { MAX_EXPERIENCE, MAX_ITEM_AMOUNT, MAX_LEVEL } from '../constants.ts';

export { MAX_EXPERIENCE };
import type { Formulas } from '../data/formulas.ts';
import type { PubData } from '../data/pub-data.ts';
import type { CharactersTable, DB } from '../db/schema.ts';

export interface ComputedStats {
  maxHp: number;
  maxTp: number;
  maxSp: number;
  maxWeight: number;
  minDamage: number;
  maxDamage: number;
  accuracy: number;
  evade: number;
  armor: number;
}

type CharacterRow = Selectable<CharactersTable>;

export interface QuestProgress {
  questId: number;
  state: number;
  npcKills: Map<number, number>;
  playerKills: number;
  doneAt: Date | null;
  completions: number;
}

export function defaultQuestProgress(questId: number): QuestProgress {
  return { questId, state: 0, npcKills: new Map(), playerKills: 0, doneAt: null, completions: 0 };
}

const MAX_WEIGHT = 250;
const MAX_VITAL = 64000;

function boundedInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export interface CharacterItemListener {
  gotItem(itemId: number): void;
  lostItem(itemId: number): void;
}

export type EquipResult =
  | { ok: true; slot: EquipmentSlot; swappedOut: number }
  | { ok: false; classRequirement: number | null };

const EQUIPMENT_SLOTS = [
  'boots',
  'accessory',
  'gloves',
  'belt',
  'armor',
  'necklace',
  'hat',
  'shield',
  'weapon',
  'ring',
  'ring2',
  'armlet',
  'armlet2',
  'bracer',
  'bracer2',
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

function equipmentSlotFor(itemType: number, subLoc: number): EquipmentSlot | null {
  switch (itemType) {
    case ItemType.Weapon:
      return 'weapon';
    case ItemType.Shield:
      return 'shield';
    case ItemType.Armor:
      return 'armor';
    case ItemType.Hat:
      return 'hat';
    case ItemType.Boots:
      return 'boots';
    case ItemType.Gloves:
      return 'gloves';
    case ItemType.Accessory:
      return 'accessory';
    case ItemType.Belt:
      return 'belt';
    case ItemType.Necklace:
      return 'necklace';
    case ItemType.Ring:
      return subLoc === 0 ? 'ring' : 'ring2';
    case ItemType.Armlet:
      return subLoc === 0 ? 'armlet' : 'armlet2';
    case ItemType.Bracer:
      return subLoc === 0 ? 'bracer' : 'bracer2';
    default:
      return null;
  }
}

export type SaveHook = (trx: Transaction<DB>) => Promise<void>;

interface SaveSnapshot {
  id: number;
  row: Omit<CharacterRow, 'id' | 'created_at'>;
  items: Array<{ character_id: number; item_id: number; quantity: number }>;
  bankItems: Array<{ character_id: number; item_id: number; quantity: number }>;
  spells: Array<{ character_id: number; spell_id: number; level: number }>;
  autoPickup: Array<{ character_id: number; item_id: number }>;
  quests: Array<{
    character_id: number;
    quest_id: number;
    state: number;
    npc_kills: string;
    player_kills: number;
    done_at: string | null;
    completions: number;
  }>;
}

export class Character {
  row: CharacterRow;
  playerId = 0;
  items: Item[] = [];
  bankItems: Item[] = [];
  spells: Spell[] = [];
  quests = new Map<number, QuestProgress>();
  private saving: Promise<void> = Promise.resolve();
  guildTag: string | null = null;
  guildName: string | null = null;
  autoPickupItems: number[] = [];
  itemListener: CharacterItemListener | null = null;

  private constructor(row: CharacterRow) {
    this.row = row;
  }

  get id(): number {
    return this.row.id;
  }

  get accountId(): number {
    return this.row.account_id;
  }

  get isGuildLeader(): boolean {
    return this.row.guild_rank === 1;
  }

  setPartner(name: string): void {
    this.row.partner = name;
    this.row.fiance = null;
  }

  setGuild(
    guildId: number | null,
    tag: string | null,
    name: string | null,
    rank: number | null,
    rankString: string | null,
  ): void {
    this.row.guild_id = guildId;
    this.guildTag = tag;
    this.guildName = name;
    this.row.guild_rank = rank;
    this.row.guild_rank_string = rankString;
  }

  get name(): string {
    return this.row.name;
  }

  get mapId(): number {
    return this.row.map;
  }

  set mapId(value: number) {
    this.row.map = value;
  }

  get coords(): Coords {
    const coords = new Coords();
    coords.x = this.row.x;
    coords.y = this.row.y;
    return coords;
  }

  setCoords(x: number, y: number): void {
    this.row.x = x;
    this.row.y = y;
  }

  get direction(): number {
    return this.row.direction;
  }

  set direction(value: number) {
    this.row.direction = value;
  }

  equipment(slot: EquipmentSlot): number {
    return this.row[slot];
  }

  static async load(db: Kysely<DB>, characterId: number): Promise<Character | null> {
    const row = await db
      .selectFrom('characters')
      .selectAll()
      .where('id', '=', characterId)
      .executeTakeFirst();
    if (row === undefined) return null;

    const character = new Character(row);
    character.sanitizeStats();
    if (row.guild_id !== null) {
      const guild = await db
        .selectFrom('guilds')
        .select(['tag', 'name'])
        .where('id', '=', row.guild_id)
        .executeTakeFirst();
      if (guild !== undefined) {
        character.guildTag = guild.tag;
        character.guildName = guild.name;
      }
    }
    const items = await db
      .selectFrom('character_inventory')
      .select(['item_id', 'quantity'])
      .where('character_id', '=', characterId)
      .execute();
    character.items = items.map((r) => {
      const item = new Item();
      item.id = r.item_id;
      item.amount = r.quantity;
      return item;
    });
    const bankItems = await db
      .selectFrom('character_bank')
      .select(['item_id', 'quantity'])
      .where('character_id', '=', characterId)
      .execute();
    character.bankItems = bankItems.map((r) => {
      const item = new Item();
      item.id = r.item_id;
      item.amount = r.quantity;
      return item;
    });
    const spells = await db
      .selectFrom('character_spells')
      .select(['spell_id', 'level'])
      .where('character_id', '=', characterId)
      .execute();
    character.spells = spells.map((r) => {
      const spell = new Spell();
      spell.id = r.spell_id;
      spell.level = r.level;
      return spell;
    });
    const autoPickup = await db
      .selectFrom('character_auto_pickup')
      .select('item_id')
      .where('character_id', '=', characterId)
      .execute();
    character.autoPickupItems = autoPickup.map((r) => r.item_id);
    const quests = await db
      .selectFrom('character_quest_progress')
      .selectAll()
      .where('character_id', '=', characterId)
      .execute();
    for (const row of quests) {
      const npcKills = new Map<number, number>();
      try {
        for (const [key, value] of Object.entries(JSON.parse(row.npc_kills) as object)) {
          npcKills.set(Number.parseInt(key, 10), Number(value));
        }
      } catch {
      }
      character.quests.set(row.quest_id, {
        questId: row.quest_id,
        state: row.state,
        npcKills,
        playerKills: row.player_kills,
        doneAt: row.done_at === null ? null : new Date(row.done_at as string | Date),
        completions: row.completions,
      });
    }
    return character;
  }

  static async exists(db: Kysely<DB>, name: string): Promise<boolean> {
    const row = await db
      .selectFrom('characters')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirst();
    return row !== undefined;
  }

  static async create(
    db: Kysely<DB>,
    accountId: number,
    details: {
      name: string;
      gender: number;
      hairStyle: number;
      hairColor: number;
      skin: number;
      map?: number;
      x?: number;
      y?: number;
      direction?: number;
      home?: string;
      adminLevel?: number;
    },
  ): Promise<Character | null> {
    const inserted = await db
      .insertInto('characters')
      .values({
        account_id: accountId,
        name: details.name,
        gender: details.gender,
        hair_style: details.hairStyle,
        hair_color: details.hairColor,
        race: details.skin,
        ...(details.map !== undefined ? { map: details.map } : {}),
        ...(details.x !== undefined ? { x: details.x } : {}),
        ...(details.y !== undefined ? { y: details.y } : {}),
        ...(details.direction !== undefined ? { direction: details.direction } : {}),
        ...(details.home !== undefined ? { home: details.home } : {}),
        ...(details.adminLevel !== undefined ? { admin_level: details.adminLevel } : {}),
      })
      .returning('id')
      .executeTakeFirst();
    if (inserted === undefined) return null;
    return Character.load(db, inserted.id);
  }

  save(db: Kysely<DB>, inTransaction?: SaveHook): Promise<void> {
    const snapshot = inTransaction === undefined ? this.snapshot() : null;
    const next = this.saving.then(
      () => this.persist(db, snapshot, inTransaction),
      () => this.persist(db, snapshot, inTransaction),
    );
    this.saving = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private snapshot(): SaveSnapshot {
    this.sanitizeVitals();
    const { id, created_at, ...row } = this.row;
    return {
      id,
      row,
      items: this.items.map((i) => ({ character_id: id, item_id: i.id, quantity: i.amount })),
      bankItems: this.bankItems.map((i) => ({ character_id: id, item_id: i.id, quantity: i.amount })),
      spells: this.spells.map((s) => ({ character_id: id, spell_id: s.id, level: s.level })),
      autoPickup: [...new Set(this.autoPickupItems)].map((itemId) => ({ character_id: id, item_id: itemId })),
      quests: [...this.quests.values()].map((q) => ({
        character_id: id,
        quest_id: q.questId,
        state: q.state,
        npc_kills: JSON.stringify(Object.fromEntries(q.npcKills)),
        player_kills: q.playerKills,
        done_at: q.doneAt === null ? null : q.doneAt.toISOString(),
        completions: q.completions,
      })),
    };
  }

  private async persist(db: Kysely<DB>, snapshot: SaveSnapshot | null, inTransaction?: SaveHook): Promise<void> {
    const state = { hookFailed: false };
    const hook =
      inTransaction === undefined
        ? undefined
        : async (trx: Transaction<DB>): Promise<void> => {
            try {
              await inTransaction(trx);
            } catch (err) {
              state.hookFailed = true;
              throw err;
            }
          };
    try {
      await this.persistOnce(db, snapshot, hook);
    } catch (err) {
      if (state.hookFailed || !(await this.dropMissingGuild(db, snapshot?.row.guild_id ?? this.row.guild_id))) {
        throw err;
      }
      await this.persistOnce(db, snapshot, hook);
    }
  }

  private async dropMissingGuild(db: Kysely<DB> | Transaction<DB>, guildId: number | null): Promise<boolean> {
    if (guildId === null) return false;
    const guild = await db
      .selectFrom('guilds')
      .select('id')
      .where('id', '=', guildId)
      .executeTakeFirst();
    if (guild !== undefined) return false;
    if (this.row.guild_id === guildId) this.setGuild(null, null, null, null, null);
    return true;
  }

  private persistOnce(db: Kysely<DB>, snapshot: SaveSnapshot | null, inTransaction?: SaveHook): Promise<void> {
    return db.transaction().execute(async (trx) => {
      if (inTransaction !== undefined) await inTransaction(trx);
      let data = snapshot ?? this.snapshot();
      if (await this.dropMissingGuild(trx, data.row.guild_id)) {
        data = { ...data, row: { ...data.row, guild_id: null, guild_rank: null, guild_rank_string: null } };
      }
      const { id } = data;
      await trx.updateTable('characters').set(data.row).where('id', '=', id).execute();
      await trx.deleteFrom('character_inventory').where('character_id', '=', id).execute();
      if (data.items.length > 0) await trx.insertInto('character_inventory').values(data.items).execute();
      await trx.deleteFrom('character_bank').where('character_id', '=', id).execute();
      if (data.bankItems.length > 0) await trx.insertInto('character_bank').values(data.bankItems).execute();
      await trx.deleteFrom('character_spells').where('character_id', '=', id).execute();
      if (data.spells.length > 0) await trx.insertInto('character_spells').values(data.spells).execute();
      await trx.deleteFrom('character_auto_pickup').where('character_id', '=', id).execute();
      if (data.autoPickup.length > 0) await trx.insertInto('character_auto_pickup').values(data.autoPickup).execute();
      await trx.deleteFrom('character_quest_progress').where('character_id', '=', id).execute();
      if (data.quests.length > 0) await trx.insertInto('character_quest_progress').values(data.quests).execute();
    });
  }

  async delete(db: Kysely<DB>): Promise<void> {
    await db.deleteFrom('characters').where('id', '=', this.id).execute();
  }

  private stats: ComputedStats = {
    maxHp: 10,
    maxTp: 10,
    maxSp: 20,
    maxWeight: 70,
    minDamage: 1,
    maxDamage: 2,
    accuracy: 0,
    evade: 0,
    armor: 0,
  };

  private adjusted = { str: 0, int: 0, wis: 0, agi: 0, con: 0, cha: 0 };

  sanitizeStats(): void {
    const r = this.row;
    const clampStat = (n: number): number => Math.min(Math.max(n, 0), 64000);
    r.strength = clampStat(r.strength);
    r.intelligence = clampStat(r.intelligence);
    r.wisdom = clampStat(r.wisdom);
    r.agility = clampStat(r.agility);
    r.constitution = clampStat(r.constitution);
    r.charisma = clampStat(r.charisma);
    r.stat_points = clampStat(r.stat_points);
    r.skill_points = clampStat(r.skill_points);
    r.karma = clampStat(r.karma);
    r.level = boundedInt(r.level, 0, MAX_LEVEL, 0);
    r.experience = boundedInt(r.experience, 0, MAX_EXPERIENCE, 0);
    r.admin_level = Math.min(Math.max(r.admin_level, 0), 5);
    r.hp = boundedInt(r.hp, 0, MAX_VITAL, 0);
    r.tp = boundedInt(r.tp, 0, MAX_VITAL, 0);
  }

  sanitizeVitals(): void {
    const r = this.row;
    r.hp = boundedInt(r.hp, 0, MAX_VITAL, this.stats.maxHp);
    r.tp = boundedInt(r.tp, 0, MAX_VITAL, this.stats.maxTp);
    r.experience = boundedInt(r.experience, 0, MAX_EXPERIENCE, 0);
  }

  calculateStats(formulas: Formulas, pubData: PubData, combat?: CombatConfig): void {
    const r = this.row;
    let str = r.strength;
    let intl = r.intelligence;
    let wis = r.wisdom;
    let agi = r.agility;
    let con = r.constitution;
    let cha = r.charisma;

    const classRecord = pubData.ecf?.parsed.classes[r.class - 1];
    if (classRecord !== undefined) {
      str += classRecord.str;
      intl += classRecord.intl;
      wis += classRecord.wis;
      agi += classRecord.agi;
      con += classRecord.con;
      cha += classRecord.cha;
    }

    let bonusHp = 0;
    let bonusTp = 0;
    let minDamage = 0;
    let maxDamage = 0;
    let accuracy = 0;
    let evade = 0;
    let armor = 0;

    for (const slot of EQUIPMENT_SLOTS) {
      const itemId = r[slot];
      if (itemId <= 0) continue;
      const item = pubData.eif?.parsed.items[itemId - 1];
      if (item === undefined) continue;
      str += item.str;
      intl += item.intl;
      wis += item.wis;
      agi += item.agi;
      con += item.con;
      cha += item.cha;
      bonusHp += item.hp;
      bonusTp += item.tp;
      minDamage += item.minDamage;
      maxDamage += item.maxDamage;
      accuracy += item.accuracy;
      evade += item.evade;
      armor += item.armor;
    }

    const vars: Record<string, number> = {
      level: r.level,
      str,
      int: intl,
      wis,
      agi,
      con,
      cha,
      base_str: r.strength,
      base_int: r.intelligence,
      base_wis: r.wisdom,
      base_agi: r.agility,
      base_con: r.constitution,
      base_cha: r.charisma,
    };

    if (combat?.useClassFormulas) {
      const family = classRecord?.statGroup ?? 0;
      const classDamage = Math.trunc(formulas.eval(`class.${family}.damage`, vars, str / 3));
      const classAccuracy = Math.trunc(formulas.eval(`class.${family}.accuracy`, vars, agi / 3));
      const classEvade = Math.trunc(formulas.eval(`class.${family}.evade`, vars, agi / 5));
      const classDefense = Math.trunc(
        formulas.eval(
          `class.${family}.defence`,
          vars,
          formulas.eval(`class.${family}.defense`, vars, con / 4),
        ),
      );
      minDamage += classDamage;
      maxDamage += classDamage;
      accuracy += classAccuracy;
      evade += classEvade;
      armor += classDefense;
    } else {
      minDamage += Math.trunc(str / 2);
      maxDamage += Math.trunc(str / 2);
      accuracy += Math.trunc(agi / 2);
      evade += Math.trunc(agi / 2);
      armor += Math.trunc(con / 2);
    }

    const baseMin = combat?.baseMinDamage ?? 1;
    const baseMax = combat?.baseMaxDamage ?? 2;
    const atZeroOnly = combat?.baseDamageAtZero ?? false;
    if (minDamage === 0 || !atZeroOnly) minDamage += baseMin;
    if (maxDamage === 0 || !atZeroOnly) maxDamage += baseMax;

    const cap = (n: number): number => Math.min(Math.max(n, 0), 64000);
    this.stats = {
      maxHp: Math.min(Math.trunc(formulas.eval('hp', vars, 10 + 2.5 * r.level)) + bonusHp, 64000),
      maxTp: Math.min(Math.trunc(formulas.eval('tp', vars, 10 + 2.5 * r.level)) + bonusTp, 64000),
      maxSp: Math.min(Math.trunc(formulas.eval('sp', vars, 20 + 2 * r.level)), 64000),
      maxWeight: Math.trunc(formulas.eval('weight', vars, 70 + r.strength)),
      minDamage: cap(minDamage),
      maxDamage: cap(maxDamage),
      accuracy: cap(accuracy),
      evade: cap(evade),
      armor: cap(armor),
    };
    this.adjusted = { str, int: intl, wis, agi, con, cha };
    if (r.hp > this.stats.maxHp) r.hp = this.stats.maxHp;
    if (r.tp > this.stats.maxTp) r.tp = this.stats.maxTp;
  }

  get computed(): ComputedStats {
    return this.stats;
  }

  get maxHp(): number {
    return this.stats.maxHp;
  }

  get maxTp(): number {
    return this.stats.maxTp;
  }

  get maxSp(): number {
    return this.stats.maxSp;
  }

  get hp(): number {
    return Math.min(this.row.hp, this.maxHp);
  }

  get tp(): number {
    return Math.min(this.row.tp, this.maxTp);
  }

  addExperience(
    gained: number,
    formulas: Formulas,
    statPointsPerLevel: number,
    skillPointsPerLevel: number,
  ): boolean {
    const current = boundedInt(this.row.experience, 0, MAX_EXPERIENCE, 0);
    const amount = Number.isFinite(gained) ? Math.trunc(gained) : 0;
    this.row.experience = Math.min(Math.max(current + amount, 0), MAX_EXPERIENCE);
    let leveledUp = false;
    while (
      this.row.level < MAX_LEVEL &&
      this.row.experience > formulas.expForLevel(this.row.level + 1)
    ) {
      this.row.level++;
      this.row.stat_points += statPointsPerLevel;
      this.row.skill_points += skillPointsPerLevel;
      leveledUp = true;
    }
    return leveledUp;
  }

  carriedWeight(pubData: PubData): number {
    let current = this.items.reduce(
      (total, item) => total + pubData.itemWeight(item.id) * item.amount,
      0,
    );
    for (const slot of EQUIPMENT_SLOTS) {
      const itemId = this.row[slot];
      if (itemId > 0) current += pubData.itemWeight(itemId);
    }
    return current;
  }

  get maxWeight(): number {
    return Math.max(0, Math.min(this.stats.maxWeight, MAX_WEIGHT));
  }

  isOverweight(pubData: PubData): boolean {
    return this.carriedWeight(pubData) > this.maxWeight;
  }

  weight(pubData: PubData): Weight {
    const weight = new Weight();
    weight.current = Math.min(this.carriedWeight(pubData), MAX_WEIGHT);
    weight.max = this.maxWeight;
    return weight;
  }

  addItem(itemId: number, amount: number, notify = true): void {
    if (amount <= 0) return;
    const existing = this.items.find((i) => i.id === itemId);
    if (existing !== undefined) {
      existing.amount = Math.min(existing.amount + amount, MAX_ITEM_AMOUNT);
    } else {
      const item = new Item();
      item.id = itemId;
      item.amount = Math.min(amount, MAX_ITEM_AMOUNT);
      this.items.push(item);
    }
    if (notify) this.itemListener?.gotItem(itemId);
  }

  removeItem(itemId: number, amount: number, notify = true): number {
    if (amount <= 0) return 0;
    const existing = this.items.find((i) => i.id === itemId);
    if (existing === undefined) return 0;
    const removed = Math.min(existing.amount, amount);
    existing.amount -= removed;
    if (existing.amount <= 0) this.items = this.items.filter((i) => i !== existing);
    if (removed > 0 && notify) this.itemListener?.lostItem(itemId);
    return removed;
  }

  heldAmount(itemId: number): number {
    return this.items.find((i) => i.id === itemId)?.amount ?? 0;
  }

  canHold(pubData: PubData, itemId: number, amount: number, maxItem = MAX_ITEM_AMOUNT): number {
    if (amount <= 0) return 0;
    const carried = this.carriedWeight(pubData);
    if (carried > this.maxWeight) return 0;
    const perItem = pubData.itemWeight(itemId);
    const fits = perItem > 0 ? Math.floor((this.maxWeight - carried) / perItem) : amount;
    const cap = Math.min(maxItem, MAX_ITEM_AMOUNT);
    return Math.max(0, Math.min(amount, fits, cap - this.heldAmount(itemId)));
  }

  canHoldAmount(itemId: number, amount: number, maxItem = MAX_ITEM_AMOUNT): number {
    const cap = Math.min(maxItem, MAX_ITEM_AMOUNT);
    return Math.max(0, Math.min(amount, cap - this.heldAmount(itemId)));
  }

  bankAmount(itemId: number): number {
    return this.bankItems.find((i) => i.id === itemId)?.amount ?? 0;
  }

  canBankHold(itemId: number, amount: number, maxPerItem: number): number {
    return Math.max(0, Math.min(amount, maxPerItem - this.bankAmount(itemId)));
  }

  get adjustedStats(): Readonly<{ str: number; int: number; wis: number; agi: number; con: number; cha: number }> {
    return this.adjusted;
  }

  isCursed(itemId: number, pubData: PubData): boolean {
    return itemId > 0 && pubData.eif?.parsed.items[itemId - 1]?.special === ItemSpecial.Cursed;
  }

  equip(itemId: number, subLoc: number, pubData: PubData, allowSwap = false): EquipResult {
    const failed: EquipResult = { ok: false, classRequirement: null };
    if (subLoc < 0 || subLoc > 1) return failed;
    if (this.heldAmount(itemId) === 0) return failed;
    const record = pubData.eif?.parsed.items[itemId - 1];
    if (record === undefined) return failed;

    if (record.type === ItemType.Armor && record.spec2 !== this.row.gender) return failed;

    if (
      this.row.level < record.levelRequirement ||
      this.adjusted.str < record.strRequirement ||
      this.adjusted.int < record.intRequirement ||
      this.adjusted.wis < record.wisRequirement ||
      this.adjusted.agi < record.agiRequirement ||
      this.adjusted.con < record.conRequirement ||
      this.adjusted.cha < record.chaRequirement
    ) {
      return failed;
    }
    if (record.classRequirement !== 0 && record.classRequirement !== this.row.class) {
      return { ok: false, classRequirement: record.classRequirement };
    }

    const slot = equipmentSlotFor(record.type, subLoc);
    if (slot === null) return failed;

    const occupant = this.row[slot];
    if (occupant !== 0) {
      if (!allowSwap || this.isCursed(occupant, pubData)) return failed;
      this.addItem(occupant, 1, false);
    }

    this.row[slot] = itemId;
    this.removeItem(itemId, 1, false);
    return { ok: true, slot, swappedOut: occupant };
  }

  unequip(itemId: number, subLoc: number, pubData: PubData): boolean {
    if (subLoc < 0 || subLoc > 1) return false;
    const record = pubData.eif?.parsed.items[itemId - 1];
    if (record === undefined) return false;
    if (record.special === ItemSpecial.Cursed) return false;
    const slot = equipmentSlotFor(record.type, subLoc);
    if (slot === null || this.row[slot] !== itemId) return false;

    this.row[slot] = 0;
    this.addItem(itemId, 1, false);
    return true;
  }

  destroyCursedEquipment(pubData: PubData): EquipmentSlot[] {
    const destroyed: EquipmentSlot[] = [];
    for (const slot of EQUIPMENT_SLOTS) {
      if (this.isCursed(this.row[slot], pubData)) {
        this.row[slot] = 0;
        destroyed.push(slot);
      }
    }
    return destroyed;
  }

  equipmentChange(pubData: PubData): EquipmentChange {
    const change = new EquipmentChange();
    change.boots = pubData.graphicId(this.row.boots);
    change.armor = pubData.graphicId(this.row.armor);
    change.hat = pubData.graphicId(this.row.hat);
    change.shield = pubData.graphicId(this.row.shield);
    change.weapon = pubData.graphicId(this.row.weapon);
    return change;
  }

  equipmentPaperdoll(): EquipmentPaperdoll {
    const equipment = new EquipmentPaperdoll();
    equipment.boots = this.row.boots;
    equipment.accessory = this.row.accessory;
    equipment.gloves = this.row.gloves;
    equipment.belt = this.row.belt;
    equipment.armor = this.row.armor;
    equipment.necklace = this.row.necklace;
    equipment.hat = this.row.hat;
    equipment.shield = this.row.shield;
    equipment.weapon = this.row.weapon;
    equipment.ring = [this.row.ring, this.row.ring2];
    equipment.armlet = [this.row.armlet, this.row.armlet2];
    equipment.bracer = [this.row.bracer, this.row.bracer2];
    return equipment;
  }

  private fillBaseStats<T extends CharacterBaseStats | CharacterBaseStatsWelcome>(base: T): T {
    const cap = (n: number): number => Math.min(Math.max(n, 0), 64000);
    base.str = cap(this.adjusted.str);
    base.intl = cap(this.adjusted.int);
    base.wis = cap(this.adjusted.wis);
    base.agi = cap(this.adjusted.agi);
    base.con = cap(this.adjusted.con);
    base.cha = cap(this.adjusted.cha);
    return base;
  }

  statsEquipmentChange(): CharacterStatsEquipmentChange {
    const stats = new CharacterStatsEquipmentChange();
    stats.maxHp = this.maxHp;
    stats.maxTp = this.maxTp;
    stats.baseStats = this.fillBaseStats(new CharacterBaseStats());
    const secondary = new CharacterSecondaryStats();
    secondary.minDamage = this.stats.minDamage;
    secondary.maxDamage = this.stats.maxDamage;
    secondary.accuracy = this.stats.accuracy;
    secondary.evade = this.stats.evade;
    secondary.armor = this.stats.armor;
    stats.secondaryStats = secondary;
    return stats;
  }

  statsUpdate(pubData: PubData): CharacterStatsUpdate {
    const stats = new CharacterStatsUpdate();
    stats.baseStats = this.fillBaseStats(new CharacterBaseStats());
    stats.maxHp = this.maxHp;
    stats.maxTp = this.maxTp;
    stats.maxSp = this.maxSp;
    stats.maxWeight = this.weight(pubData).max;
    const secondary = new CharacterSecondaryStats();
    secondary.minDamage = this.stats.minDamage;
    secondary.maxDamage = this.stats.maxDamage;
    secondary.accuracy = this.stats.accuracy;
    secondary.evade = this.stats.evade;
    secondary.armor = this.stats.armor;
    stats.secondaryStats = secondary;
    return stats;
  }

  statsReset(): CharacterStatsReset {
    const stats = new CharacterStatsReset();
    stats.statPoints = this.row.stat_points;
    stats.skillPoints = this.row.skill_points;
    stats.hp = this.hp;
    stats.maxHp = this.maxHp;
    stats.tp = this.tp;
    stats.maxTp = this.maxTp;
    stats.maxSp = this.maxSp;
    stats.base = this.fillBaseStats(new CharacterBaseStats());
    const secondary = new CharacterSecondaryStats();
    secondary.minDamage = this.stats.minDamage;
    secondary.maxDamage = this.stats.maxDamage;
    secondary.accuracy = this.stats.accuracy;
    secondary.evade = this.stats.evade;
    secondary.armor = this.stats.armor;
    stats.secondary = secondary;
    return stats;
  }

  statsWelcome(): CharacterStatsWelcome {
    const stats = new CharacterStatsWelcome();
    stats.hp = this.hp;
    stats.maxHp = this.maxHp;
    stats.tp = this.tp;
    stats.maxTp = this.maxTp;
    stats.maxSp = this.maxSp;
    stats.statPoints = this.row.stat_points;
    stats.skillPoints = this.row.skill_points;
    stats.karma = this.row.karma;
    const secondary = new CharacterSecondaryStats();
    secondary.minDamage = this.stats.minDamage;
    secondary.maxDamage = this.stats.maxDamage;
    secondary.accuracy = this.stats.accuracy;
    secondary.evade = this.stats.evade;
    secondary.armor = this.stats.armor;
    stats.secondary = secondary;
    stats.base = this.fillBaseStats(new CharacterBaseStatsWelcome());
    return stats;
  }

  equipmentWelcome(): EquipmentWelcome {
    const equipment = new EquipmentWelcome();
    equipment.boots = this.row.boots;
    equipment.gloves = this.row.gloves;
    equipment.accessory = this.row.accessory;
    equipment.armor = this.row.armor;
    equipment.belt = this.row.belt;
    equipment.necklace = this.row.necklace;
    equipment.hat = this.row.hat;
    equipment.shield = this.row.shield;
    equipment.weapon = this.row.weapon;
    equipment.ring = [this.row.ring, this.row.ring2];
    equipment.armlet = [this.row.armlet, this.row.armlet2];
    equipment.bracer = [this.row.bracer, this.row.bracer2];
    return equipment;
  }

  toMapInfo(pubData: PubData): CharacterMapInfo {
    const info = new CharacterMapInfo();
    info.name = this.name;
    info.playerId = this.playerId;
    info.mapId = this.mapId;
    const coords = new BigCoords();
    coords.x = this.row.x;
    coords.y = this.row.y;
    info.coords = coords;
    info.direction = this.direction;
    info.classId = this.row.class;
    info.guildTag = (this.guildTag ?? '').padEnd(3, ' ');
    info.level = this.row.level;
    info.gender = this.row.gender;
    info.hairStyle = this.row.hair_style;
    info.hairColor = this.row.hair_color;
    info.skin = this.row.race;
    info.maxHp = this.maxHp;
    info.hp = this.hp;
    info.maxTp = this.maxTp;
    info.tp = this.tp;
    const equipment = new EquipmentMapInfo();
    equipment.boots = pubData.graphicId(this.row.boots);
    equipment.armor = pubData.graphicId(this.row.armor);
    equipment.hat = pubData.graphicId(this.row.hat);
    equipment.shield = pubData.graphicId(this.row.shield);
    equipment.weapon = pubData.graphicId(this.row.weapon);
    info.equipment = equipment;
    info.sitState = this.row.sitting;
    info.invisible = this.row.hidden === 1;
    return info;
  }
}
