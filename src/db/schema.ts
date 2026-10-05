import type { Generated } from 'kysely';

export interface AccountsTable {
  id: Generated<number>;
  name: string;
  password_hash: string;
  password_version: Generated<number>;
  email: string;
  real_name: string;
  location: string;
  computer: string;
  hdid: string;
  created_at: Generated<Date | string>;
  last_login_at: Date | string | null;
  last_ip: string | null;
  locked_at: Date | string | null;
  lock_reason: string | null;
}

export interface AccountSessionsTable {
  id: Generated<number>;
  account_id: number;
  token_hash: string;
  created_at: Generated<Date | string>;
  ttl: Generated<number>;
  expires_at: Date | string | null;
}

export interface BansTable {
  id: Generated<number>;
  account_id: number | null;
  character_name: string | null;
  ip: string | null;
  hdid: string | null;
  reason: string | null;
  banned_by: string | null;
  created_at: Generated<Date | string>;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
}

export interface LoginHistoryTable {
  id: Generated<number>;
  account_id: number;
  character_id: number | null;
  ip: string | null;
  event: string;
  created_at: Generated<Date | string>;
}

export interface GuildsTable {
  id: Generated<number>;
  tag: string;
  name: string;
  description: string | null;
  bank: Generated<number>;
  created_at: Generated<Date | string>;
}

export interface GuildRanksTable {
  id: Generated<number>;
  guild_id: number;
  index: number;
  rank: string;
}

export interface CharactersTable {
  id: Generated<number>;
  account_id: number;
  name: string;
  map: Generated<number>;
  x: Generated<number>;
  y: Generated<number>;
  direction: Generated<number>;
  sitting: Generated<number>;
  hidden: Generated<number>;
  title: string | null;
  home: string | null;
  fiance: string | null;
  partner: string | null;
  admin_level: Generated<number>;
  class: Generated<number>;
  gender: Generated<number>;
  race: Generated<number>;
  hair_style: Generated<number>;
  hair_color: Generated<number>;
  bank_level: Generated<number>;
  gold_bank: Generated<number>;
  guild_id: number | null;
  guild_rank: number | null;
  guild_rank_string: string | null;
  level: Generated<number>;
  experience: Generated<number>;
  hp: Generated<number>;
  tp: Generated<number>;
  strength: Generated<number>;
  intelligence: Generated<number>;
  wisdom: Generated<number>;
  agility: Generated<number>;
  constitution: Generated<number>;
  charisma: Generated<number>;
  stat_points: Generated<number>;
  skill_points: Generated<number>;
  karma: Generated<number>;
  usage: Generated<number>;
  boots: Generated<number>;
  accessory: Generated<number>;
  gloves: Generated<number>;
  belt: Generated<number>;
  armor: Generated<number>;
  necklace: Generated<number>;
  hat: Generated<number>;
  shield: Generated<number>;
  weapon: Generated<number>;
  ring: Generated<number>;
  ring2: Generated<number>;
  armlet: Generated<number>;
  armlet2: Generated<number>;
  bracer: Generated<number>;
  bracer2: Generated<number>;
  created_at: Generated<Date | string>;
}

export interface CharacterItemsTable {
  character_id: number;
  item_id: number;
  quantity: Generated<number>;
}

export interface CharacterSpellsTable {
  character_id: number;
  spell_id: number;
  level: Generated<number>;
}

export interface CharacterQuestProgressTable {
  character_id: number;
  quest_id: number;
  state: number;
  npc_kills: string;
  player_kills: number;
  done_at: Date | string | null;
  completions: number;
}

export interface CharacterAutoPickupTable {
  character_id: number;
  item_id: number;
}

export interface BoardPostsTable {
  id: Generated<number>;
  board_id: number;
  character_id: number;
  author: string;
  subject: string;
  body: string;
  created_at: Generated<Date | string>;
}

export interface DB {
  board_posts: BoardPostsTable;
  accounts: AccountsTable;
  account_sessions: AccountSessionsTable;
  bans: BansTable;
  login_history: LoginHistoryTable;
  guilds: GuildsTable;
  guild_ranks: GuildRanksTable;
  characters: CharactersTable;
  character_inventory: CharacterItemsTable;
  character_bank: CharacterItemsTable;
  character_spells: CharacterSpellsTable;
  character_quest_progress: CharacterQuestProgressTable;
  character_auto_pickup: CharacterAutoPickupTable;
  mutes: MutesTable;
  reports: ReportsTable;
  admin_audit: AdminAuditTable;
}

export interface MutesTable {
  id: Generated<number>;
  character_id: number;
  character_name: string;
  reason: string | null;
  muted_by: string | null;
  created_at: Generated<Date | string>;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_by: string | null;
}

export interface ReportsTable {
  id: Generated<number>;
  kind: string;
  reporter_id: number | null;
  reporter: string;
  reportee: string | null;
  message: string;
  created_at: Generated<Date | string>;
  status: Generated<string>;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  note: string | null;
}

export interface AdminAuditTable {
  id: Generated<number>;
  created_at: Generated<Date | string>;
  actor_kind: string;
  actor: string;
  source_ip: string | null;
  action: string;
  target: string | null;
  details: string | null;
}

export function toDbTimestamp(date: Date): string {
  return date.toISOString();
}

export function toUtcDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value.includes('Z') || value.includes('+') ? value : `${value}Z`);
}
