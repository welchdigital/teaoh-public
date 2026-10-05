import {
  AdminInteractListServerPacket,
  AdminInteractTellServerPacket,
  AdminLevel,
  BigCoords,
  CharacterBaseStats,
  CharacterElementalStats,
  CharacterSecondaryStatsInfoLookup,
  CharacterStatsInfoLookup,
  Item,
  StatSkillJunkServerPacket,
  StatSkillRemoveServerPacket,
  TalkTellServerPacket,
  THREE_MAX,
  ThreeItem,
} from 'eolib';
import {
  ActionError,
  announce,
  banCharacter,
  canActOn,
  dropGroundItem,
  evacuateMap,
  freeCharacter,
  freezeCharacter,
  giveItem,
  hiddenFrom,
  jailCharacter,
  kickCharacter,
  liveTarget,
  mapById,
  mapCentre,
  muteCharacter,
  normalizeProperty,
  offlineTarget,
  playerActor,
  quake,
  recordAudit,
  reloadMap,
  sendTalkServer,
  setCharacterProperties,
  setGlobalLock,
  spawnNpcs,
  unmuteCharacter,
  warpCharacter,
  warpPlayerTo,
  type Actor,
  type CharacterTarget,
} from '../../admin/actions.ts';
import { describeMinutes, parseDuration } from '../../admin/duration.ts';
import { resolveItem, resolveNpc } from '../../admin/lookups.ts';
import { Character } from '../../character/character.ts';
import { log } from '../../log.ts';
import { handleAutoPickupCommand } from '../../world/map/auto-pickup.ts';
import { toggleHidden } from '../../world/map/character/hide.ts';
import type { Player } from '../player.ts';

export type ArgType = 'UInt' | 'String';

export interface ArgSpec {
  name: string;
  type: ArgType;
  required: boolean;
}

export interface CommandSpec {
  name: string;
  aliases: readonly string[];
  level: number;
  usage: string;
  description: string;
  args: readonly ArgSpec[];
  join?: 'amount' | 'value' | 'all' | 'rest';
}

const playerArg = (required = true): ArgSpec => ({ name: 'player', type: 'String', required });

export const ADMIN_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'warp',
    aliases: ['w'],
    level: AdminLevel.Guardian,
    usage: '$warp 5 25 25',
    description: 'Warp to a location',
    args: [
      { name: 'map', type: 'UInt', required: true },
      { name: 'x', type: 'UInt', required: false },
      { name: 'y', type: 'UInt', required: false },
    ],
  },
  {
    name: 'warptome',
    aliases: ['wtm'],
    level: AdminLevel.GameMaster,
    usage: '$warptome player',
    description: 'Warp target player to your location',
    args: [playerArg()],
  },
  {
    name: 'warpmeto',
    aliases: ['wmt'],
    level: AdminLevel.LightGuide,
    usage: '$warpmeto player',
    description: 'Warp yourself to target player',
    args: [playerArg()],
  },
  {
    name: 'player',
    aliases: ['p'],
    level: AdminLevel.LightGuide,
    usage: '$player player',
    description: 'View player information',
    args: [playerArg()],
  },
  {
    name: 'inventory',
    aliases: ['i', 'inv'],
    level: AdminLevel.LightGuide,
    usage: '$inventory player',
    description: 'View player inventory and bank',
    args: [playerArg()],
  },
  {
    name: 'jail',
    aliases: ['j'],
    level: AdminLevel.Guardian,
    usage: '$jail player',
    description: 'Jail a player',
    args: [playerArg()],
  },
  {
    name: 'free',
    aliases: ['f'],
    level: AdminLevel.Guardian,
    usage: '$free player',
    description: 'Unjail a player',
    args: [playerArg()],
  },
  {
    name: 'freeze',
    aliases: ['l'],
    level: AdminLevel.Guardian,
    usage: '$freeze player',
    description: "Freeze a player's movement",
    args: [playerArg()],
  },
  {
    name: 'unfreeze',
    aliases: ['u'],
    level: AdminLevel.Guardian,
    usage: '$unfreeze player',
    description: "Un-freeze a player's movement",
    args: [playerArg()],
  },
  {
    name: 'mute',
    aliases: ['m'],
    level: AdminLevel.Guardian,
    usage: '$mute player {90s,30m,2h,1d,perm}',
    description: 'Mute a player',
    args: [playerArg(), { name: 'duration', type: 'String', required: false }],
  },
  {
    name: 'unmute',
    aliases: [],
    level: AdminLevel.Guardian,
    usage: '$unmute player',
    description: 'Unmute a player',
    args: [playerArg()],
  },
  {
    name: 'kick',
    aliases: ['k'],
    level: AdminLevel.Guardian,
    usage: '$kick player',
    description: 'Kick a player',
    args: [playerArg()],
  },
  {
    name: 'skick',
    aliases: ['sk'],
    level: AdminLevel.Guardian,
    usage: '$skick player',
    description: 'Silently kick a player',
    args: [playerArg()],
  },
  {
    name: 'global',
    aliases: ['g'],
    level: AdminLevel.Guardian,
    usage: '$global',
    description: 'Toggle global chat on/off',
    args: [],
  },
  {
    name: 'announce',
    aliases: [],
    level: AdminLevel.Guardian,
    usage: '$announce message',
    description: 'Server-wide announcement',
    args: [{ name: 'message', type: 'String', required: true }],
    join: 'all',
  },
  {
    name: 'quake',
    aliases: ['q'],
    level: AdminLevel.Guardian,
    usage: '$quake magnitude',
    description: 'Cause an earthquake for all players',
    args: [{ name: 'magnitude', type: 'UInt', required: false }],
  },
  {
    name: 'ban',
    aliases: ['b'],
    level: AdminLevel.GameMaster,
    usage: '$ban player {2h,1d} (omit duration for permanent ban)',
    description: 'Ban a player',
    args: [playerArg(), { name: 'duration', type: 'String', required: false }],
  },
  {
    name: 'sban',
    aliases: ['sb'],
    level: AdminLevel.GameMaster,
    usage: '$sban player {2h,1d} (omit duration for permanent ban)',
    description: 'Silently ban a player',
    args: [playerArg(), { name: 'duration', type: 'String', required: false }],
  },
  {
    name: 'remap',
    aliases: [],
    level: AdminLevel.GameMaster,
    usage: '$remap',
    description: 'Reloads a map file',
    args: [],
  },
  {
    name: 'evacuate',
    aliases: ['e'],
    level: AdminLevel.GameMaster,
    usage: '$e',
    description: 'Start evacuate event',
    args: [],
  },
  {
    name: 'spawnitem',
    aliases: ['si', 'item', 'sitem'],
    level: AdminLevel.HighGameMaster,
    usage: '$si gold 100',
    description: 'Spawn an item into your inventory',
    args: [
      { name: 'item', type: 'String', required: true },
      { name: 'amount', type: 'UInt', required: false },
    ],
    join: 'amount',
  },
  {
    name: 'dropitem',
    aliases: ['di', 'ditem'],
    level: AdminLevel.HighGameMaster,
    usage: '$di gold 100',
    description: 'Spawn an item at your feet',
    args: [
      { name: 'item', type: 'String', required: true },
      { name: 'amount', type: 'UInt', required: false },
    ],
    join: 'amount',
  },
  {
    name: 'hide',
    aliases: ['x'],
    level: AdminLevel.Guardian,
    usage: '$x',
    description: 'Toggle hide state',
    args: [],
  },
  {
    name: 'spawnnpc',
    aliases: ['sn', 'snpc'],
    level: AdminLevel.GameMaster,
    usage: '$sn goat',
    description: 'Spawn an npc at your position',
    args: [
      { name: 'npc', type: 'String', required: true },
      { name: 'amount', type: 'UInt', required: false },
    ],
    join: 'amount',
  },
  {
    name: 'captcha',
    aliases: ['c'],
    level: AdminLevel.Guardian,
    usage: '$c noob 1000',
    description: 'Show a captcha to a player',
    args: [playerArg(), { name: 'experience', type: 'UInt', required: true }],
  },
  {
    name: 'set',
    aliases: ['s'],
    level: AdminLevel.GameMaster,
    usage: '$s title goron The Great',
    description: 'Set property of a character',
    args: [
      { name: 'property', type: 'String', required: true },
      playerArg(),
      { name: 'value', type: 'String', required: true },
    ],
    join: 'value',
  },
  {
    name: 'skillreset',
    aliases: [],
    level: AdminLevel.GameMaster,
    usage: '$skillreset player',
    description: "Reset a player's learned skills",
    args: [playerArg()],
  },
  {
    name: 'commands',
    aliases: ['help'],
    level: AdminLevel.LightGuide,
    usage: '$commands',
    description: 'List the commands available to you',
    args: [],
  },
];

export const PLAYER_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'autopickup',
    aliases: ['ap'],
    level: AdminLevel.Player,
    usage: '#autopickup add gold',
    description: 'Configure auto item pickups',
    args: [
      { name: 'sub_command', type: 'String', required: false },
      { name: 'item', type: 'String', required: false },
    ],
    join: 'rest',
  },
  {
    name: 'uptime',
    aliases: ['u'],
    level: AdminLevel.Player,
    usage: '#uptime',
    description: 'Get the server uptime',
    args: [],
  },
  {
    name: 'online',
    aliases: [],
    level: AdminLevel.Player,
    usage: '#online',
    description: 'Count the players online',
    args: [],
  },
  {
    name: 'loc',
    aliases: [],
    level: AdminLevel.Player,
    usage: '#loc',
    description: 'Show your location',
    args: [],
  },
  {
    name: 'ping',
    aliases: [],
    level: AdminLevel.Player,
    usage: '#ping',
    description: 'Check the server responds',
    args: [],
  },
];

function findIn(list: readonly CommandSpec[], name: string): CommandSpec | undefined {
  const lower = name.toLowerCase();
  return list.find((command) => command.name === lower || command.aliases.includes(lower));
}

export function findAdminCommand(name: string): CommandSpec | undefined {
  return findIn(ADMIN_COMMANDS, name);
}

export function findPlayerCommand(name: string): CommandSpec | undefined {
  return findIn(PLAYER_COMMANDS, name);
}

function isUInt(value: string): boolean {
  if (!/^\+?\d+$/.test(value)) return false;
  return Number(value) <= 0xffff_ffff;
}

function parseUInt(value: string): number {
  return Number.parseInt(value.replace(/^\+/, ''), 10);
}

export function prepareArgs(command: CommandSpec, raw: readonly string[]): string[] {
  const args = [...raw];
  switch (command.join) {
    case 'amount':
      if (args.length > 1) {
        const last = args[args.length - 1]!;
        if (isUInt(last)) return [args.slice(0, -1).join(' '), last];
        return [args.join(' ')];
      }
      return args;
    case 'value':
      if (args.length > 3) return [args[0]!, args[1]!, args.slice(2).join(' ')];
      if (args.length < 3) args.push('');
      return args;
    case 'all':
      return args.length === 0 ? args : [args.join(' ')];
    case 'rest':
      return args.length > 1 ? [args[0]!, args.slice(1).join(' ')] : args;
    default:
      return args;
  }
}

export function validateArgs(command: CommandSpec, args: readonly string[]): string | null {
  const required = command.args.filter((arg) => arg.required).length;
  if (args.length < required) {
    return `Wrong number of args. Got ${args.length}, expected: ${required}. (usage: "${command.usage}")`;
  }
  if (args.length > command.args.length) {
    return `Too many args. Got ${args.length}, expected: ${command.args.length}. (usage: "${command.usage}")`;
  }
  for (let i = 0; i < args.length; i++) {
    const spec = command.args[i]!;
    const raw = args[i]!;
    if (spec.type === 'UInt' && !isUInt(raw)) {
      return `Invalid arg type. Got ${raw}, expected: UInt. (usage: "${command.usage}")`;
    }
  }
  return null;
}

function reply(player: Player, message: string): void {
  sendTalkServer(player, message);
}

function whisperFromServer(player: Player, message: string): void {
  const packet = new TalkTellServerPacket();
  packet.playerName = 'Server';
  packet.message = message;
  player.bus.send(packet);
}

export async function handleAdminCommand(player: Player, message: string): Promise<boolean> {
  const character = player.character;
  if (character === null) return false;
  const parts = message.slice(1).split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return false;
  const [name, ...rawArgs] = parts as [string, ...string[]];

  const command = findAdminCommand(name);
  if (command === undefined) {
    reply(player, `Unknown command: ${name}`);
    return true;
  }
  if (character.row.admin_level < command.level) {
    log.warn(
      { cat: 'admin', admin: character.name, command: command.name, level: character.row.admin_level },
      'admin command denied',
    );
    return true;
  }

  const args = prepareArgs(command, rawArgs);
  const invalid = validateArgs(command, args);
  if (invalid !== null) {
    reply(player, invalid);
    return true;
  }

  const actor = playerActor(player);
  try {
    await runAdminCommand(player, actor, command.name, args);
  } catch (err) {
    if (err instanceof ActionError) reply(player, err.message);
    else {
      log.error({ cat: 'admin', admin: character.name, command: command.name, err: String(err) }, 'admin command failed');
      reply(player, `Command ${command.name} failed.`);
    }
  }
  return true;
}

function targetRef(name: string): { name: string } {
  return { name: name.toLowerCase() };
}

function requireOnlineTarget(player: Player, actor: Actor, name: string): CharacterTarget {
  const target = liveTarget(player.server, targetRef(name));
  if (target === null || hiddenFrom(actor, target)) throw new ActionError(404, `${name} is not online.`);
  return target;
}

function assertCanUse(actor: Actor, target: CharacterTarget): void {
  if (!canActOn(actor, target)) {
    throw new ActionError(403, `You cannot use that on ${target.name} (equal or higher admin level).`);
  }
}

async function runAdminCommand(player: Player, actor: Actor, command: string, args: string[]): Promise<void> {
  const server = player.server;
  const character = player.character!;
  const self = { player };
  switch (command) {
    case 'warp': {
      const mapId = parseUInt(args[0]!);
      const map = mapById(server, mapId);
      if (map === undefined) throw new ActionError(404, `Map ${mapId} does not exist.`);
      const coords = args.length >= 3 ? { x: parseUInt(args[1]!), y: parseUInt(args[2]!) } : mapCentre(map);
      await warpCharacter(server, actor, self, mapId, coords.x, coords.y);
      return;
    }
    case 'warptome': {
      const target = requireOnlineTarget(player, actor, args[0]!);
      await warpCharacter(server, actor, { player: target.player! }, character.mapId, character.row.x, character.row.y);
      return;
    }
    case 'warpmeto': {
      const target = requireOnlineTarget(player, actor, args[0]!);
      const tc = target.player!.character!;
      warpPlayerTo(server, player, tc.mapId, tc.row.x, tc.row.y);
      await recordAudit(server, actor, 'warpmeto', target.name, { map: tc.mapId, x: tc.row.x, y: tc.row.y });
      return;
    }
    case 'player':
      await sendPlayerInfo(player, actor, args[0]!);
      return;
    case 'inventory':
      await sendPlayerInventory(player, actor, args[0]!);
      return;
    case 'jail':
      await jailCharacter(server, actor, targetRef(args[0]!));
      return;
    case 'free':
      notify(player, await freeCharacter(server, actor, targetRef(args[0]!)));
      return;
    case 'freeze':
    case 'unfreeze':
      await freezeCharacter(server, actor, targetRef(args[0]!), command === 'freeze');
      return;
    case 'mute': {
      let durationMs: number | null = player.config.admin.muteLength * 1000;
      if (args[1] !== undefined) {
        const parsed = parseDuration(args[1]);
        if (!parsed.ok) throw new ActionError(400, parsed.error);
        durationMs = parsed.minutes === null ? null : parsed.minutes * 60_000;
      }
      notify(player, await muteCharacter(server, actor, targetRef(args[0]!), durationMs, null));
      return;
    }
    case 'unmute':
      notify(player, await unmuteCharacter(server, actor, targetRef(args[0]!)));
      return;
    case 'kick':
    case 'skick':
      notify(player, await kickCharacter(server, actor, targetRef(args[0]!), command === 'skick'));
      return;
    case 'ban':
    case 'sban': {
      let minutes: number | null = null;
      if (args[1] !== undefined) {
        const parsed = parseDuration(args[1]);
        if (!parsed.ok) throw new ActionError(400, parsed.error);
        minutes = parsed.minutes;
      }
      const result = await banCharacter(server, actor, {
        target: targetRef(args[0]!),
        durationMinutes: minutes,
        banIp: true,
        banHdid: true,
        silent: command === 'sban',
      });
      if (command === 'sban') reply(player, `${result.targetName ?? args[0]} banned ${describeMinutes(minutes)}.`);
      return;
    }
    case 'global':
      await setGlobalLock(server, actor, !server.globalLocked);
      return;
    case 'announce':
      await announce(server, actor, 'announce', args[0]!);
      return;
    case 'quake':
      await quake(server, actor, args[0] === undefined ? 1 : parseUInt(args[0]));
      return;
    case 'remap':
      if (player.map === null) return;
      await reloadMap(server, actor, player.map);
      reply(player, `Map ${player.map.id} reloaded.`);
      return;
    case 'evacuate': {
      if (player.map === null) return;
      const started = await evacuateMap(server, actor, player.map, undefined, true);
      if (!started) reply(player, 'Evacuation cancelled.');
      return;
    }
    case 'spawnitem':
    case 'dropitem': {
      const resolved = resolveItem(server.pubData, args[0]!);
      if (!resolved.ok) throw new ActionError(404, resolved.error);
      const amount = args[1] === undefined ? 1 : parseUInt(args[1]);
      if (command === 'spawnitem') {
        await giveItem(server, actor, self, resolved.id, amount);
      } else if (player.map !== null) {
        await dropGroundItem(server, actor, player.map, resolved.id, amount, character.row.x, character.row.y);
      }
      return;
    }
    case 'spawnnpc': {
      if (player.map === null) return;
      const resolved = resolveNpc(server.pubData, args[0]!);
      if (!resolved.ok) throw new ActionError(404, resolved.error);
      const amount = args[1] === undefined ? 1 : parseUInt(args[1]);
      const spawned = await spawnNpcs(server, actor, player.map, resolved.id, character.row.x, character.row.y, amount);
      if (spawned < amount) reply(player, `Failed to spawn npc! Index exceeds 252 (spawned ${spawned} of ${amount}).`);
      return;
    }
    case 'hide': {
      if (player.map === null) return;
      const hidden = toggleHidden(player.map, character);
      reply(player, hidden ? 'You are now hidden.' : 'You are now visible.');
      await recordAudit(server, actor, hidden ? 'hide' : 'unhide', character.name);
      return;
    }
    case 'captcha': {
      const target = requireOnlineTarget(player, actor, args[0]!);
      assertCanUse(actor, target);
      if (!target.player!.isDeep) throw new ActionError(409, `${target.name} is not using a Deep client.`);
      const experience = parseUInt(args[1]!);
      target.player!.showCaptcha(experience);
      await recordAudit(server, actor, 'captcha', target.name, { experience });
      return;
    }
    case 'set': {
      const property = normalizeProperty(args[0]!);
      if (property === null) throw new ActionError(400, `Unknown property: ${args[0]}`);
      const result = await setCharacterProperties(server, actor, targetRef(args[1]!), [[property, args[2]!]]);
      reply(player, `Set ${result.target.name}'s ${property} to ${String(result.values[property] ?? args[2])}.`);
      return;
    }
    case 'skillreset':
      await skillReset(player, actor, args[0]!);
      return;
    case 'commands':
      listCommands(player);
      return;
    default:
      reply(player, `Unimplemented command: ${command}`);
  }
}

function notify(player: Player, outcome: { message?: string }): void {
  if (outcome.message !== undefined) reply(player, outcome.message);
}

async function skillReset(player: Player, actor: Actor, name: string): Promise<void> {
  const target = requireOnlineTarget(player, actor, name);
  assertCanUse(actor, target);
  const targetPlayer = target.player!;
  const tc = targetPlayer.character!;
  for (const spell of tc.spells) {
    const remove = new StatSkillRemoveServerPacket();
    remove.spellId = spell.id;
    targetPlayer.bus.send(remove);
  }
  const removed = tc.spells.length;
  tc.spells.length = 0;
  tc.row.skill_points = Math.min(64_000, tc.row.level * player.config.world.skillPointsPerLevel);
  const junk = new StatSkillJunkServerPacket();
  junk.stats = tc.statsReset();
  targetPlayer.bus.send(junk);
  reply(player, `Reset ${tc.name}'s skills.`);
  await recordAudit(player.server, actor, 'skillreset', tc.name, { removed });
}

function listCommands(player: Player): void {
  const level = player.character!.row.admin_level;
  whisperFromServer(player, 'Admin commands available to you:');
  for (const command of ADMIN_COMMANDS) {
    if (level < command.level) continue;
    const aliases = command.aliases.length > 0 ? ` (${command.aliases.map((a) => `$${a}`).join(', ')})` : '';
    whisperFromServer(player, `$${command.name}${aliases} - ${command.description}: ${command.usage}`);
  }
  whisperFromServer(player, `Player commands: ${PLAYER_COMMANDS.map((c) => `#${c.name}`).join(' ')}`);
}

async function loadInspected(player: Player, actor: Actor, name: string): Promise<{ target: CharacterTarget; character: Character }> {
  const ref = targetRef(name);
  const target = liveTarget(player.server, ref) ?? (await offlineTarget(player.server, ref));
  if (target === null) throw new ActionError(404, `Character "${name}" not found.`);
  assertCanUse(actor, target);
  if (target.player !== null) return { target, character: target.player.character! };
  const character = await Character.load(player.server.db, target.id);
  if (character === null) throw new ActionError(404, `Character "${name}" not found.`);
  character.calculateStats(player.server.formulas, player.server.pubData, player.config.combat);
  return { target, character };
}

async function sendPlayerInfo(player: Player, actor: Actor, name: string): Promise<void> {
  const { character } = await loadInspected(player, actor, name);
  const packet = new AdminInteractTellServerPacket();
  packet.name = character.name;
  packet.usage = character.row.usage;
  packet.goldBank = character.row.gold_bank;
  packet.exp = character.row.experience;
  packet.level = character.row.level;
  packet.mapId = character.mapId;
  const coords = new BigCoords();
  coords.x = character.row.x;
  coords.y = character.row.y;
  packet.mapCoords = coords;
  const stats = new CharacterStatsInfoLookup();
  stats.hp = character.hp;
  stats.maxHp = character.maxHp;
  stats.tp = character.tp;
  stats.maxTp = character.maxTp;
  const adjusted = character.adjustedStats;
  const base = new CharacterBaseStats();
  base.str = clampShort(adjusted.str);
  base.intl = clampShort(adjusted.int);
  base.wis = clampShort(adjusted.wis);
  base.agi = clampShort(adjusted.agi);
  base.con = clampShort(adjusted.con);
  base.cha = clampShort(adjusted.cha);
  stats.baseStats = base;
  const computed = character.computed;
  const secondary = new CharacterSecondaryStatsInfoLookup();
  secondary.minDamage = computed.minDamage;
  secondary.maxDamage = computed.maxDamage;
  secondary.accuracy = computed.accuracy;
  secondary.evade = computed.evade;
  secondary.armor = computed.armor;
  stats.secondaryStats = secondary;
  const elemental = new CharacterElementalStats();
  elemental.light = 0;
  elemental.dark = 0;
  elemental.fire = 0;
  elemental.water = 0;
  elemental.earth = 0;
  elemental.wind = 0;
  stats.elementalStats = elemental;
  packet.stats = stats;
  packet.weight = character.weight(player.server.pubData);
  player.bus.send(packet);
}

function clampShort(value: number): number {
  return Math.min(64_000, Math.max(0, value));
}

async function sendPlayerInventory(player: Player, actor: Actor, name: string): Promise<void> {
  const { character } = await loadInspected(player, actor, name);
  const packet = new AdminInteractListServerPacket();
  packet.name = character.name;
  packet.usage = character.row.usage;
  packet.goldBank = character.row.gold_bank;
  packet.inventory = character.items.map((entry) => {
    const item = new Item();
    item.id = entry.id;
    item.amount = entry.amount;
    return item;
  });
  packet.bank = character.bankItems.map((entry) => {
    const item = new ThreeItem();
    item.id = entry.id;
    item.amount = Math.min(entry.amount, THREE_MAX - 1);
    return item;
  });
  player.bus.send(packet);
}

export function formatUptime(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

export function handlePlayerCommand(player: Player, message: string): boolean {
  const character = player.character;
  if (character === null) return false;
  const parts = message.slice(1).split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return false;
  const [name, ...rawArgs] = parts as [string, ...string[]];
  const command = findPlayerCommand(name);
  if (command === undefined) return false;

  const args = prepareArgs(command, rawArgs);
  const invalid = validateArgs(command, args);
  if (invalid !== null) {
    reply(player, invalid);
    return true;
  }

  switch (command.name) {
    case 'autopickup':
      return handleAutoPickupCommand(player, args);
    case 'uptime':
      reply(player, `Server uptime: ${formatUptime(player.server.startedAt)}`);
      return true;
    case 'online': {
      const count = player.server.playerCount();
      reply(player, `${count} player${count === 1 ? '' : 's'} online`);
      return true;
    }
    case 'loc':
      reply(player, `Map ${character.mapId} at ${character.row.x}, ${character.row.y}`);
      return true;
    case 'ping':
      reply(player, 'pong');
      return true;
    default:
      return false;
  }
}
