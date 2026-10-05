import { readFileSync } from "node:fs";
import { CHAR_MAX, PacketAction, PacketFamily, THREE_MAX } from "eolib";
import { parse as parseToml } from "smol-toml";
import { MAX_ITEM_AMOUNT } from "./constants.ts";
import { DEFAULT_LANG_NAME, LANG_NAME_PATTERN } from "./lang.ts";
import { isLogLevel, log } from "./log.ts";
import { parseCidr } from "./net/ip.ts";

export interface ServerConfig {
  host: string;
  port: number;
  websocketEnabled: boolean;
  websocketPort: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxPlayers: number;
  maxLoginAttempts: number;
  pingRate: number;
  enforceSequence: boolean;
  minVersion: string;
  maxVersion: string;
  trustProxy: boolean;
  trustedProxies: string[];
  ipReconnectLimit: number;
  hangupDelay: number;
  acceptTimeout: number;
  loginTimeout: number;
  saveRate: number;
  lang: string;
  generatePub: boolean;
}

export interface AccountConfig {
  delayTime: number;
  emailValidation: boolean;
  recovery: boolean;
  maxCharacters: number;
  recoveryShowEmail: boolean;
  recoveryMaskEmail: boolean;
  emailPinTtl: number;
  emailPinAttempts: number;
  maxEmailsPerAccount: number;
  maxEmailsPerIp: number;
  maxAccountsPerConnection: number;
  maxAccountsPerIp: number;
  accountCreateWindow: number;
  minPasswordLength: number;
  maxPasswordLength: number;
  maxLoginFailuresPerAccount: number;
  maxLoginFailuresPerIp: number;
  loginFailureWindow: number;
  passwordHashConcurrency: number;
  passwordHashQueue: number;
}

export interface SmtpConfig {
  fromName: string;
  fromAddress: string;
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
}

export interface NewCharacterConfig {
  spawnMap: number;
  spawnX: number;
  spawnY: number;
  spawnDirection: number;
  home: string;
}

export interface JailConfig {
  freeMap: number;
  freeX: number;
  freeY: number;
}

export interface CharacterConfig {
  maxSkin: number;
  maxHairStyle: number;
  maxHairColor: number;
  minNameLength: number;
  maxNameLength: number;
  firstCharacterAdmin: boolean;
  maxTitleLength: number;
}

export interface DatabaseConfig {
  driver: "sqlite" | "postgres";
  sqlitePath: string;
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
}

export interface WorldConfig {
  tickRate: number;
  jailMap: number;
  jailX: number;
  jailY: number;
  rescueMap: number;
  rescueX: number;
  rescueY: number;
  spawnMap: number;
  spawnX: number;
  spawnY: number;
  expMultiplier: number;
  statPointsPerLevel: number;
  skillPointsPerLevel: number;
  recoverRate: number;
  npcRecoverRate: number;
  dropDistance: number;
  dropProtectPlayer: number;
  dropProtectNpc: number;
  globalPk: boolean;
  chestSpawnOnBoot: boolean;
  chestSpawnRate: number;
  spikeRate: number;
  spikeDamage: number;
  drainRate: number;
  drainHpDamage: number;
  drainTpDamage: number;
  warpSuckRate: number;
  ghostRate: number;
  quakeRate: number;
  quakes: QuakeConfig[];
  usageRate: number;
  infoRevealsDrops: boolean;
  walkInterval: number;
  walkBurst: number;
}

export interface QuakeConfig {
  minTicks: number;
  maxTicks: number;
  minStrength: number;
  maxStrength: number;
}

export interface BarberConfig {
  baseCost: number;
  costPerLevel: number;
}

export interface GuildConfig {
  minPlayers: number;
  createCost: number;
  recruitCost: number;
  minDeposit: number;
  bankMaxGold: number;
  minTagLength: number;
  maxTagLength: number;
  maxNameLength: number;
  maxDescriptionLength: number;
  maxRankLength: number;
  defaultLeaderRankName: string;
  defaultRecruiterRankName: string;
  defaultNewMemberRankName: string;
  recruitRank: number;
  announce: boolean;
}

export interface BoardConfig {
  maxPosts: number;
  maxUserPosts: number;
  maxRecentPosts: number;
  recentPostTime: number;
  maxSubjectLength: number;
  maxPostLength: number;
  datePosts: boolean;
  adminBoard: number;
  adminMaxPosts: number;
}

export interface WeaponRange {
  weapon: number;
  range: number;
  arrows: boolean;
}

export interface CombatConfig {
  weaponRanges: WeaponRange[];
  enforceWeight: boolean;
  useClassFormulas: boolean;
  baseMinDamage: number;
  baseMaxDamage: number;
  baseDamageAtZero: boolean;
  castTimeSlack: number;
}

export interface NpcsConfig {
  actRate: number;
  chaseDistance: number;
  boredTimer: number;
  instantSpawn: boolean;
  freezeOnEmptyMap: boolean;
  speeds: number[];
  talkRate: number;
}

export interface DataConfig {
  dir: string;
}

export interface MarriageConfig {
  approvalCost: number;
  divorceCost: number;
  femaleArmorId: number;
  maleArmorId: number;
  minLevel: number;
  ringItemId: number;
  ceremonyStartDelaySeconds: number;
  mfxId: number;
  celebrationEffectId: number;
}

export interface JukeboxConfig {
  cost: number;
  maxTrackId: number;
  trackTimer: number;
  instrumentItems: number[];
  maxNoteId: number;
}

export interface SlnConfig {
  enabled: boolean;
  url: string;
  host: string;
  site: string;
  serverName: string;
  rate: number;
  zone: string;
  clientUrl: string;
  discord: string;
  facebook: string;
  twitter: string;
  youtube: string;
  port: number;
}

export interface AdminApiConfig {
  enabled: boolean;
  host: string;
  port: number;
  key: string;
  corsOrigin: string;
  uiDir: string;
  maxAuthFailures: number;
  authLockoutSeconds: number;
  reportCooldown: number;
  muteLength: number;
  allowedHosts: string[];
}

export interface LogConfig {
  level: string;
}

export interface PacketRateLimit {
  family: string;
  action: string;
  limit: number;
  burst?: number;
}

export interface LimitsConfig {
  packetRateLimits: PacketRateLimit[];
  maxQueuedPackets: number;
  maxSendBuffer: number;
  maxPartySize: number;
  maxBankGold: number;
  maxItem: number;
  maxTrade: number;
  maxChest: number;
}

export interface BankConfig {
  maxItemAmount: number;
  baseSize: number;
  sizeStep: number;
  maxUpgrades: number;
  upgradeBaseCost: number;
  upgradeCostStep: number;
}

export interface ChestConfig {
  slots: number;
}

export interface MapSavesConfig {
  enabled: boolean;
  dir: string;
}

export interface ItemsConfig {
  infiniteUseItems: number[];
  protectedItems: number[];
}

export interface MapConfig {
  doorCloseRate: number;
  maxItems: number;
}

export interface EvacuateConfig {
  sfxId: number;
  timerSeconds: number;
  timerStep: number;
}

export interface AutoPickupConfig {
  enabled: boolean;
  rate: number;
}

export interface Config {
  items: ItemsConfig;
  map: MapConfig;
  evacuate: EvacuateConfig;
  autoPickup: AutoPickupConfig;
  server: ServerConfig;
  database: DatabaseConfig;
  account: AccountConfig;
  smtp: SmtpConfig;
  character: CharacterConfig;
  newCharacter: NewCharacterConfig;
  world: WorldConfig;
  jail: JailConfig;
  npcs: NpcsConfig;
  combat: CombatConfig;
  guild: GuildConfig;
  board: BoardConfig;
  barber: BarberConfig;
  marriage: MarriageConfig;
  jukebox: JukeboxConfig;
  sln: SlnConfig;
  limits: LimitsConfig;
  bank: BankConfig;
  chest: ChestConfig;
  mapSaves: MapSavesConfig;
  admin: AdminApiConfig;
  data: DataConfig;
  log: LogConfig;
}

export const MAX_CHARACTER_NAME_COLUMN = 16;
export const MAX_PACKET_RATE_LIMIT = 1000;
export const ANY_ACTION = "*";
export const MAX_PACKET_RATE_BURST = 100;
const OPTIONAL_TABLE_KEYS: ReadonlySet<string> = new Set(["burst"]);

export function defaultPacketRateLimits(): PacketRateLimit[] {
  const entries: Array<[string, string, number, number?]> = [
    ["Account", "Agree", 1000],
    ["AdminInteract", "Tell", 1000],
    ["AdminInteract", "Report", 1000],
    ["Attack", "Use", 500],
    ["Bank", "Open", 1000],
    ["Barber", "Open", 1000],
    ["Board", "Open", 1000],
    ["Board", "Take", 1000],
    ["Board", "Create", 1000],
    ["Board", "Remove", 1000],
    ["Book", "Request", 1000],
    ["Chair", "Request", 1000],
    ["Chest", "Open", 1000],
    ["Citizen", "Open", 1000],
    ["Door", "Open", 500],
    ["Emote", "Report", 120],
    ["Face", "Player", 120],
    ["Guild", "Request", 1000],
    ["Guild", "Accept", 1000],
    ["Guild", "Agree", 1000],
    ["Guild", "Buy", 1000],
    ["Guild", "Create", 1000],
    ["Guild", "Junk", 1000],
    ["Guild", "Kick", 1000],
    ["Guild", "Player", 1000],
    ["Guild", "Rank", 1000],
    ["Guild", "Remove", 1000],
    ["Guild", "Take", 1000],
    ["Guild", "Open", 1000],
    ["Guild", "Tell", 1000],
    ["Guild", "Report", 1000],
    ["Guild", "Use", 1000],
    ["Item", "Use", 150, 3],
    ["Item", "Drop", 150, 3],
    ["Item", "Junk", 150, 3],
    ["Item", "Get", 100, 3],
    ["Jukebox", "Msg", 1000],
    ["Locker", "Open", 1000],
    ["Marriage", "Request", 1000],
    ["NpcRange", "Request", 200, 10],
    ["Paperdoll", "Request", 1000],
    ["Paperdoll", "Add", 150, 3],
    ["Paperdoll", "Remove", 150, 3],
    ["Party", "Request", 500],
    ["PlayerRange", "Request", 200, 10],
    ["Players", "Accept", 1000],
    ["Players", "Request", 1000],
    ["Players", "List", 1000],
    ["Priest", "Request", 1000],
    ["Range", "Request", 200, 10],
    ["Refresh", "Request", 1000],
    ["Shop", "Open", 1000],
    ["Sit", "Request", 120],
    ["Spell", "Request", 300],
    ["Spell", "TargetSelf", 300],
    ["Spell", "TargetOther", 300],
    ["Spell", "TargetGroup", 300],
    ["Talk", "Request", 500, 5],
    ["Talk", "Open", 500, 5],
    ["Talk", "Msg", 1000, 3],
    ["Talk", "Tell", 500, 5],
    ["Talk", "Report", 500, 5],
    ["Talk", "Admin", 500, 5],
    ["Talk", "Announce", 1000, 3],
    ["Trade", "Request", 1000],
    ["Walk", ANY_ACTION, 300],
  ];
  return entries.map(([family, action, limit, burst = 1]) => ({ family, action, limit, burst }));
}

export function defaultConfig(): Config {
  return {
    items: {
      infiniteUseItems: [],
      protectedItems: [],
    },
    map: {
      doorCloseRate: 3,
      maxItems: 250,
    },
    evacuate: {
      sfxId: 51,
      timerSeconds: 60,
      timerStep: 15,
    },
    autoPickup: {
      enabled: false,
      rate: 8,
    },
    server: {
      host: "0.0.0.0",
      port: 8078,
      websocketEnabled: true,
      websocketPort: 8079,
      maxConnections: 300,
      maxConnectionsPerIp: 3,
      maxPlayers: 200,
      maxLoginAttempts: 3,
      pingRate: 60,
      enforceSequence: true,
      minVersion: "0.0.28",
      maxVersion: "0.3.29",
      trustProxy: false,
      trustedProxies: ["127.0.0.0/8", "::1"],
      ipReconnectLimit: 10,
      hangupDelay: 10,
      acceptTimeout: 30,
      loginTimeout: 600,
      saveRate: 5,
      lang: DEFAULT_LANG_NAME,
      generatePub: false,
    },
    database: {
      driver: "sqlite",
      sqlitePath: "data/teaoh.db",
      host: "127.0.0.1",
      port: 5432,
      name: "teaoh",
      user: "teaoh",
      password: "teaoh",
    },
    account: {
      delayTime: 10,
      emailValidation: false,
      recovery: false,
      maxCharacters: 3,
      recoveryShowEmail: true,
      recoveryMaskEmail: true,
      emailPinTtl: 10,
      emailPinAttempts: 3,
      maxEmailsPerAccount: 3,
      maxEmailsPerIp: 5,
      maxAccountsPerConnection: 2,
      maxAccountsPerIp: 10,
      accountCreateWindow: 3600,
      minPasswordLength: 6,
      maxPasswordLength: 64,
      maxLoginFailuresPerAccount: 10,
      maxLoginFailuresPerIp: 30,
      loginFailureWindow: 900,
      passwordHashConcurrency: 2,
      passwordHashQueue: 32,
    },
    smtp: {
      fromName: "",
      fromAddress: "",
      host: "",
      port: 587,
      username: "",
      password: "",
      secure: false,
    },
    character: {
      maxSkin: 3,
      maxHairStyle: 20,
      maxHairColor: 9,
      minNameLength: 4,
      maxNameLength: 12,
      firstCharacterAdmin: true,
      maxTitleLength: 32,
    },
    newCharacter: {
      spawnMap: 192,
      spawnX: 6,
      spawnY: 6,
      spawnDirection: 0,
      home: "Wanderer",
    },
    world: {
      tickRate: 125,
      jailMap: 76,
      jailX: 5,
      jailY: 4,
      rescueMap: 4,
      rescueX: 24,
      rescueY: 24,
      spawnMap: 192,
      spawnX: 7,
      spawnY: 6,
      expMultiplier: 1,
      statPointsPerLevel: 3,
      skillPointsPerLevel: 4,
      recoverRate: 720,
      npcRecoverRate: 840,
      dropDistance: 2,
      dropProtectPlayer: 5,
      dropProtectNpc: 30,
      globalPk: false,
      chestSpawnOnBoot: true,
      chestSpawnRate: 480,
      spikeRate: 12,
      spikeDamage: 0.2,
      drainRate: 125,
      drainHpDamage: 0.1,
      drainTpDamage: 0.1,
      warpSuckRate: 15,
      ghostRate: 5,
      quakeRate: 40,
      quakes: [
        { minTicks: 4, maxTicks: 12, minStrength: 0, maxStrength: 1 },
        { minTicks: 6, maxTicks: 12, minStrength: 0, maxStrength: 2 },
        { minTicks: 2, maxTicks: 10, minStrength: 3, maxStrength: 5 },
        { minTicks: 1, maxTicks: 4, minStrength: 6, maxStrength: 8 },
      ],
      usageRate: 60,
      infoRevealsDrops: true,
      walkInterval: 360,
      walkBurst: 3,
    },
    jail: {
      freeMap: 76,
      freeX: 9,
      freeY: 11,
    },
    npcs: {
      actRate: 5,
      chaseDistance: 10,
      boredTimer: 240,
      instantSpawn: false,
      freezeOnEmptyMap: true,
      speeds: [5, 5, 10, 15, 30, 60, 120],
      talkRate: 300,
    },
    combat: {
      weaponRanges: [
        { weapon: 297, range: 5, arrows: true },
        { weapon: 316, range: 5, arrows: true },
        { weapon: 457, range: 5, arrows: true },
        { weapon: 365, range: 10, arrows: false },
      ],
      enforceWeight: true,
      useClassFormulas: false,
      baseMinDamage: 1,
      baseMaxDamage: 2,
      baseDamageAtZero: false,
      castTimeSlack: 200,
    },
    guild: {
      minPlayers: 10,
      createCost: 50000,
      recruitCost: 1000,
      minDeposit: 1000,
      bankMaxGold: 2_000_000_000,
      minTagLength: 2,
      maxTagLength: 3,
      maxNameLength: 24,
      maxDescriptionLength: 240,
      maxRankLength: 16,
      defaultLeaderRankName: "Leader",
      defaultRecruiterRankName: "Recruiter",
      defaultNewMemberRankName: "New Member",
      recruitRank: 1,
      announce: true,
    },
    board: {
      maxPosts: 20,
      maxUserPosts: 6,
      maxRecentPosts: 2,
      recentPostTime: 30,
      maxSubjectLength: 32,
      maxPostLength: 2048,
      datePosts: true,
      adminBoard: 5,
      adminMaxPosts: 100,
    },
    barber: {
      baseCost: 0,
      costPerLevel: 200,
    },
    marriage: {
      approvalCost: 500,
      divorceCost: 10000,
      femaleArmorId: 163,
      maleArmorId: 133,
      minLevel: 5,
      ringItemId: 374,
      ceremonyStartDelaySeconds: 20,
      mfxId: 40,
      celebrationEffectId: 1,
    },
    jukebox: {
      cost: 25,
      maxTrackId: 20,
      trackTimer: 90,
      instrumentItems: [49, 50],
      maxNoteId: 36,
    },
    sln: {
      enabled: false,
      url: "https://apollo-games.com/SLN/sln.php/",
      host: "",
      site: "",
      serverName: "teaoh",
      rate: 5,
      zone: "",
      clientUrl: "",
      discord: "",
      facebook: "",
      twitter: "",
      youtube: "",
      port: 0,
    },
    limits: {
      packetRateLimits: defaultPacketRateLimits(),
      maxQueuedPackets: 64,
      maxSendBuffer: 1_048_576,
      maxPartySize: 9,
      maxBankGold: 2_000_000_000,
      maxItem: 2_000_000_000,
      maxTrade: 2_000_000_000,
      maxChest: 10_000_000,
    },
    bank: {
      maxItemAmount: 200,
      baseSize: 25,
      sizeStep: 5,
      maxUpgrades: 7,
      upgradeBaseCost: 1000,
      upgradeCostStep: 1000,
    },
    chest: {
      slots: 5,
    },
    mapSaves: {
      enabled: true,
      dir: "",
    },
    admin: {
      enabled: true,
      host: "127.0.0.1",
      port: 8080,
      key: "",
      corsOrigin: "*",
      uiDir: "admin-ui/dist",
      maxAuthFailures: 10,
      authLockoutSeconds: 300,
      reportCooldown: 60,
      muteLength: 90,
      allowedHosts: [],
    },
    data: {
      dir: "data",
    },
    log: {
      level: "info",
    },
  };
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

export type ConfigWarn = (message: string) => void;

const defaultWarn: ConfigWarn = (message) => log.warn({ cat: "config" }, message);

export function configFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return env["TEAOH_CONFIG"] ?? "config/teaoh.toml";
}

export function loadConfig(
  filePath = configFilePath(),
  env: NodeJS.ProcessEnv = process.env,
  warn: ConfigWarn = defaultWarn,
): Config {
  const config = defaultConfig();

  let fileValues: Record<string, unknown> = {};
  try {
    fileValues = parseToml(readFileSync(filePath, "utf8"));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const knownSections = new Set<string>();
  for (const [sectionName, section] of Object.entries(config)) {
    const snakeSection = camelToSnake(sectionName);
    knownSections.add(snakeSection);
    const fileSection = fileValues[snakeSection];
    const record = section as Record<string, unknown>;

    if (fileSection !== undefined && !isPlainObject(fileSection)) {
      throw new Error(`${snakeSection}: expected a table`);
    }

    const knownKeys = new Set<string>();
    for (const key of Object.keys(section)) {
      const snakeKey = camelToSnake(key);
      knownKeys.add(snakeKey);

      if (fileSection !== undefined && snakeKey in fileSection) {
        record[key] = coerce(
          record[key],
          fileSection[snakeKey],
          `${snakeSection}.${snakeKey}`,
          warn,
        );
      }

      const envKey = `TEAOH_${snakeSection.toUpperCase()}_${snakeKey.toUpperCase()}`;
      const envValue = env[envKey];
      if (envValue !== undefined) {
        record[key] = coerce(record[key], envValue, envKey, warn);
      }
    }

    if (fileSection !== undefined) {
      for (const key of Object.keys(fileSection)) {
        if (!knownKeys.has(key)) warn(`unknown config key "${snakeSection}.${key}"`);
      }
    }
  }

  for (const sectionName of Object.keys(fileValues)) {
    if (!knownSections.has(sectionName)) warn(`unknown config section "${sectionName}"`);
  }

  validateConfig(config, warn);
  return config;
}

export function validateConfig(config: Config, warn: ConfigWarn = defaultWarn): void {
  if (
    config.database.driver !== "sqlite" &&
    config.database.driver !== "postgres"
  ) {
    throw new Error(
      `Invalid database.driver "${config.database.driver}" (expected "sqlite" or "postgres")`,
    );
  }

  const { character } = config;
  if (character.maxNameLength > MAX_CHARACTER_NAME_COLUMN) {
    warn(
      `character.max_name_length ${character.maxNameLength} exceeds the database limit; using ${MAX_CHARACTER_NAME_COLUMN}`,
    );
    character.maxNameLength = MAX_CHARACTER_NAME_COLUMN;
  }
  if (character.minNameLength < 1) character.minNameLength = 1;
  if (character.minNameLength > character.maxNameLength) {
    warn(
      `character.min_name_length ${character.minNameLength} exceeds max_name_length; using ${character.maxNameLength}`,
    );
    character.minNameLength = character.maxNameLength;
  }

  const { server, world, limits, newCharacter } = config;
  server.saveRate = Math.max(0, server.saveRate);
  server.ipReconnectLimit = Math.max(0, server.ipReconnectLimit);
  server.hangupDelay = Math.max(1, server.hangupDelay);
  world.usageRate = Math.max(1, Math.floor(world.usageRate));
  limits.maxQueuedPackets = Math.max(1, Math.floor(limits.maxQueuedPackets));
  limits.maxSendBuffer = Math.max(65_536, Math.floor(limits.maxSendBuffer));
  if (newCharacter.spawnDirection < 0 || newCharacter.spawnDirection > 3) {
    warn(`new_character.spawn_direction ${newCharacter.spawnDirection} is not 0-3; using 0`);
    newCharacter.spawnDirection = 0;
  }

  limits.packetRateLimits = limits.packetRateLimits.map((entry, i) =>
    normalizePacketRateLimit(entry, `limits.packet_rate_limits[${i}]`, warn),
  );

  normalizeWorldSections(config, warn);
  normalizeSocialSections(config, warn);
  normalizeEconomySections(config, warn);
  normalizeAdminSections(config, warn);
  normalizeNetSections(config, warn);
}

export const MAX_PASSWORD_LENGTH_LIMIT = 128;
const MAX_APPEARANCE = CHAR_MAX - 1;

function clampWarn(value: number, min: number, max: number, key: string, warn: ConfigWarn): number {
  const clamped = Number.isFinite(value) ? clampInt(value, min, max) : min;
  if (clamped !== value) warn(`${key} ${value} is outside ${min}-${max}; using ${clamped}`);
  return clamped;
}

function portOr(value: number, fallback: number, key: string, warn: ConfigWarn): number {
  if (Number.isInteger(value) && value >= 0 && value <= 65_535) return value;
  warn(`${key} ${value} is not a port number (0-65535); using ${fallback}`);
  return fallback;
}

function normalizeNetSections(config: Config, warn: ConfigWarn): void {
  const { server, account, character, world } = config;
  server.port = portOr(server.port, 8078, "server.port", warn);
  server.websocketPort = portOr(server.websocketPort, 8079, "server.websocket_port", warn);
  server.maxConnections = clampWarn(server.maxConnections, 1, 65_535, "server.max_connections", warn);
  server.maxConnectionsPerIp = clampWarn(server.maxConnectionsPerIp, 0, 65_535, "server.max_connections_per_ip", warn);
  server.maxPlayers = clampWarn(server.maxPlayers, 1, 64_000, "server.max_players", warn);
  server.maxLoginAttempts = clampWarn(server.maxLoginAttempts, 1, 1000, "server.max_login_attempts", warn);
  server.pingRate = clampWarn(server.pingRate, 5, 3600, "server.ping_rate", warn);
  server.acceptTimeout = clampWarn(server.acceptTimeout, 0, 3600, "server.accept_timeout", warn);
  server.loginTimeout = clampWarn(server.loginTimeout, 0, 86_400, "server.login_timeout", warn);
  server.lang = server.lang.trim();
  if (!LANG_NAME_PATTERN.test(server.lang)) {
    warn(`server.lang "${server.lang}" must be 1-32 letters, digits, "-" or "_"; using ${DEFAULT_LANG_NAME}`);
    server.lang = DEFAULT_LANG_NAME;
  }
  server.trustedProxies = server.trustedProxies.filter((entry) => {
    if (parseCidr(String(entry)) !== null) return true;
    warn(`server.trusted_proxies: ignoring invalid address or CIDR ${JSON.stringify(entry)}`);
    return false;
  });
  world.tickRate = clampWarn(world.tickRate, 10, 1000, "world.tick_rate", warn);
  account.delayTime = clampWarn(account.delayTime, 0, 600, "account.delay_time", warn);
  account.maxAccountsPerConnection = clampWarn(account.maxAccountsPerConnection, 0, 1000, "account.max_accounts_per_connection", warn);
  account.maxAccountsPerIp = clampWarn(account.maxAccountsPerIp, 0, 1_000_000, "account.max_accounts_per_ip", warn);
  account.accountCreateWindow = clampWarn(account.accountCreateWindow, 1, 604_800, "account.account_create_window", warn);
  account.minPasswordLength = clampWarn(account.minPasswordLength, 1, MAX_PASSWORD_LENGTH_LIMIT, "account.min_password_length", warn);
  account.maxPasswordLength = clampWarn(
    account.maxPasswordLength,
    account.minPasswordLength,
    MAX_PASSWORD_LENGTH_LIMIT,
    "account.max_password_length",
    warn,
  );
  account.maxLoginFailuresPerAccount = clampWarn(account.maxLoginFailuresPerAccount, 0, 1_000_000, "account.max_login_failures_per_account", warn);
  account.maxLoginFailuresPerIp = clampWarn(account.maxLoginFailuresPerIp, 0, 1_000_000, "account.max_login_failures_per_ip", warn);
  account.loginFailureWindow = clampWarn(account.loginFailureWindow, 1, 604_800, "account.login_failure_window", warn);
  account.passwordHashConcurrency = clampWarn(account.passwordHashConcurrency, 1, 64, "account.password_hash_concurrency", warn);
  account.passwordHashQueue = clampWarn(account.passwordHashQueue, 0, 10_000, "account.password_hash_queue", warn);
  character.maxSkin = clampWarn(character.maxSkin, 0, MAX_APPEARANCE, "character.max_skin", warn);
  character.maxHairStyle = clampWarn(character.maxHairStyle, 0, MAX_APPEARANCE, "character.max_hair_style", warn);
  character.maxHairColor = clampWarn(character.maxHairColor, 0, MAX_APPEARANCE, "character.max_hair_color", warn);
}

function normalizeAdminSections(config: Config, warn: ConfigWarn): void {
  const { admin, sln } = config;
  const level = config.log.level.trim().toLowerCase();
  if (!isLogLevel(level)) {
    warn(`log.level "${config.log.level}" is not a pino level; using info`);
    config.log.level = "info";
  } else {
    config.log.level = level;
  }
  admin.maxAuthFailures = Math.max(1, Math.floor(admin.maxAuthFailures));
  admin.authLockoutSeconds = Math.max(1, Math.floor(admin.authLockoutSeconds));
  admin.reportCooldown = Math.max(0, Math.floor(admin.reportCooldown));
  admin.muteLength = Math.max(1, Math.floor(admin.muteLength));
  admin.allowedHosts = admin.allowedHosts.flatMap((entry) => {
    const value = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (/^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(\.[a-z0-9_-]+)*)(:\d{1,5})?$/.test(value)) return [value];
    warn(`admin.allowed_hosts: ignoring invalid host ${JSON.stringify(entry)}`);
    return [];
  });
  if (!Number.isInteger(sln.port) || sln.port < 0 || sln.port > 65535) {
    warn(`sln.port ${sln.port} is not 0-65535; using 0 (server.port)`);
    sln.port = 0;
  }
  if (sln.enabled && sln.host.trim() === "") {
    warn("sln.enabled is set but sln.host is empty; the server list will reject check-ins until it is set");
  }
}

const THREE_LIMIT = THREE_MAX - 1;

function normalizeEconomySections(config: Config, warn: ConfigWarn): void {
  const { limits, bank, chest, world, jukebox, barber, mapSaves } = config;
  if (mapSaves.dir.trim() === "") mapSaves.dir = `${config.data.dir.replace(/[\\/]+$/, "")}/map_saves`;
  const clampWarn = (value: number, min: number, max: number, key: string): number => {
    const clamped = clampInt(value, min, max);
    if (clamped !== value) warn(`${key} ${value} is outside ${min}-${max}; using ${clamped}`);
    return clamped;
  };
  limits.maxItem = clampWarn(limits.maxItem, 1, MAX_ITEM_AMOUNT, "limits.max_item");
  limits.maxBankGold = clampWarn(limits.maxBankGold, 0, MAX_ITEM_AMOUNT, "limits.max_bank_gold");
  limits.maxTrade = clampWarn(limits.maxTrade, 1, limits.maxItem, "limits.max_trade");
  limits.maxChest = clampWarn(limits.maxChest, 1, THREE_LIMIT, "limits.max_chest");
  bank.maxItemAmount = clampWarn(bank.maxItemAmount, 1, THREE_LIMIT, "bank.max_item_amount");
  bank.baseSize = clampWarn(bank.baseSize, 0, CHAR_MAX - 1, "bank.base_size");
  bank.sizeStep = clampWarn(bank.sizeStep, 0, CHAR_MAX - 1, "bank.size_step");
  bank.maxUpgrades = clampWarn(bank.maxUpgrades, 0, CHAR_MAX - 1, "bank.max_upgrades");
  bank.upgradeBaseCost = clampWarn(bank.upgradeBaseCost, 0, MAX_ITEM_AMOUNT, "bank.upgrade_base_cost");
  bank.upgradeCostStep = clampWarn(bank.upgradeCostStep, 0, MAX_ITEM_AMOUNT, "bank.upgrade_cost_step");
  chest.slots = clampWarn(chest.slots, 1, CHAR_MAX - 1, "chest.slots");
  world.chestSpawnRate = clampWarn(world.chestSpawnRate, 1, Number.MAX_SAFE_INTEGER, "world.chest_spawn_rate");
  jukebox.cost = clampWarn(jukebox.cost, 0, MAX_ITEM_AMOUNT, "jukebox.cost");
  jukebox.trackTimer = clampWarn(jukebox.trackTimer, 0, Number.MAX_SAFE_INTEGER, "jukebox.track_timer");
  barber.baseCost = clampWarn(barber.baseCost, 0, MAX_ITEM_AMOUNT, "barber.base_cost");
  barber.costPerLevel = clampWarn(barber.costPerLevel, 0, MAX_ITEM_AMOUNT, "barber.cost_per_level");
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeSocialSections(config: Config, warn: ConfigWarn): void {
  const { board, guild, limits } = config;
  if (!Number.isInteger(board.adminBoard) || board.adminBoard < 1 || board.adminBoard > 8) {
    warn(`board.admin_board ${board.adminBoard} is not 1-8; using 5`);
    board.adminBoard = 5;
  }
  board.maxPosts = clampInt(board.maxPosts, 1, CHAR_MAX - 1);
  board.adminMaxPosts = clampInt(board.adminMaxPosts, 1, CHAR_MAX - 1);
  board.maxUserPosts = Math.max(1, Math.floor(board.maxUserPosts));
  board.maxRecentPosts = Math.max(1, Math.floor(board.maxRecentPosts));
  board.recentPostTime = Math.max(0, board.recentPostTime);
  board.maxSubjectLength = clampInt(board.maxSubjectLength, 1, MAX_BOARD_SUBJECT_COLUMN);
  board.maxPostLength = clampInt(board.maxPostLength, 1, MAX_BOARD_BODY_COLUMN);
  guild.recruitRank = clampInt(guild.recruitRank, 1, 9);
  limits.maxPartySize = clampInt(limits.maxPartySize, 2, CHAR_MAX - 1);
}

export const MAX_BOARD_SUBJECT_COLUMN = 64;
export const MAX_BOARD_BODY_COLUMN = 2048;

export const MAX_TITLE_COLUMN = 32;

function itemIdList(values: unknown[], source: string, warn: ConfigWarn): number[] {
  const ids: number[] = [];
  for (const value of values) {
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) ids.push(id);
    else warn(`${source}: ignoring invalid item id ${JSON.stringify(value)}`);
  }
  return ids;
}

function normalizeWorldSections(config: Config, warn: ConfigWarn): void {
  const { items, map, evacuate, autoPickup, character, world } = config;
  world.walkInterval = Math.max(0, Math.floor(world.walkInterval));
  world.walkBurst = Math.max(1, Math.floor(world.walkBurst));
  items.infiniteUseItems = itemIdList(items.infiniteUseItems, "items.infinite_use_items", warn);
  items.protectedItems = itemIdList(items.protectedItems, "items.protected_items", warn);
  map.doorCloseRate = Math.max(1, Math.floor(map.doorCloseRate));
  map.maxItems = Math.floor(map.maxItems);
  evacuate.sfxId = Math.min(Math.max(0, Math.floor(evacuate.sfxId)), 252);
  evacuate.timerStep = Math.max(1, Math.floor(evacuate.timerStep));
  evacuate.timerSeconds = Math.max(0, Math.floor(evacuate.timerSeconds));
  autoPickup.rate = Math.max(1, Math.floor(autoPickup.rate));
  if (character.maxTitleLength > MAX_TITLE_COLUMN) {
    warn(
      `character.max_title_length ${character.maxTitleLength} exceeds the database limit; using ${MAX_TITLE_COLUMN}`,
    );
    character.maxTitleLength = MAX_TITLE_COLUMN;
  }
  character.maxTitleLength = Math.max(0, Math.floor(character.maxTitleLength));
}

function resolveEnumName(
  names: Record<string, string | number>,
  value: string,
  source: string,
): string {
  const lower = value.toLowerCase();
  for (const name of Object.keys(names)) {
    if (Number.isNaN(Number(name)) && name.toLowerCase() === lower) return name;
  }
  throw new Error(`${source}: unknown value "${value}"`);
}

function normalizePacketRateLimit(
  entry: PacketRateLimit,
  source: string,
  warn: ConfigWarn,
): PacketRateLimit {
  const family = resolveEnumName(PacketFamily, entry.family, `${source}.family`);
  const action =
    entry.action.trim() === ANY_ACTION
      ? ANY_ACTION
      : resolveEnumName(PacketAction, entry.action, `${source}.action`);
  let limit = Math.floor(entry.limit);
  if (limit < 0 || limit > MAX_PACKET_RATE_LIMIT) {
    const clamped = Math.min(MAX_PACKET_RATE_LIMIT, Math.max(0, limit));
    warn(`${source}.limit ${entry.limit} is outside 0-${MAX_PACKET_RATE_LIMIT}; using ${clamped}`);
    limit = clamped;
  }
  const rawBurst = entry.burst ?? 1;
  const burst = clampInt(Number.isFinite(rawBurst) ? rawBurst : 1, 1, MAX_PACKET_RATE_BURST);
  if (burst !== rawBurst) warn(`${source}.burst ${rawBurst} is outside 1-${MAX_PACKET_RATE_BURST}; using ${burst}`);
  return burst > 1 ? { family, action, limit, burst } : { family, action, limit };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function parseStructured(incoming: unknown, source: string): unknown {
  if (typeof incoming !== "string") return incoming;
  try {
    return JSON.parse(incoming);
  } catch {
    throw new Error(`${source}: expected JSON, got "${incoming}"`);
  }
}

function coerce(current: unknown, incoming: unknown, source: string, warn: ConfigWarn): unknown {
  if (Array.isArray(current)) {
    const value = parseStructured(incoming, source);
    if (!Array.isArray(value)) throw new Error(`${source}: expected an array`);
    const template: unknown = current[0];
    if (template === undefined) return value;
    return value.map((element, i) => coerce(template, element, `${source}[${i}]`, warn));
  }

  if (isPlainObject(current)) {
    const value = parseStructured(incoming, source);
    if (!isPlainObject(value)) throw new Error(`${source}: expected a table`);
    const result: Record<string, unknown> = {};
    const known = new Set<string>();
    for (const key of Object.keys(current)) {
      const snakeKey = camelToSnake(key);
      known.add(snakeKey);
      known.add(key);
      const raw = snakeKey in value ? value[snakeKey] : value[key];
      if (raw === undefined && OPTIONAL_TABLE_KEYS.has(snakeKey)) continue;
      if (raw === undefined) throw new Error(`${source}: missing "${snakeKey}"`);
      result[key] = coerce(current[key], raw, `${source}.${snakeKey}`, warn);
    }
    for (const key of Object.keys(value)) {
      if (!known.has(key)) warn(`unknown config key "${source}.${key}"`);
    }
    return result;
  }

  switch (typeof current) {
    case "number": {
      if (typeof incoming !== "number" && typeof incoming !== "string") {
        throw new Error(`${source}: expected a number, got ${JSON.stringify(incoming)}`);
      }
      const n = typeof incoming === "number" ? incoming : Number(incoming);
      if (!Number.isFinite(n))
        throw new Error(`${source}: expected a number, got "${incoming}"`);
      return n;
    }
    case "boolean": {
      if (typeof incoming === "boolean") return incoming;
      if (incoming === "true" || incoming === "1") return true;
      if (incoming === "false" || incoming === "0") return false;
      throw new Error(`${source}: expected a boolean, got "${String(incoming)}"`);
    }
    default:
      if (typeof incoming === "object" && incoming !== null) {
        throw new Error(`${source}: expected a string, got ${JSON.stringify(incoming)}`);
      }
      return String(incoming);
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
