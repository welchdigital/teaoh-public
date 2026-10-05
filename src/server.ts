import type { Kysely } from 'kysely';
import { MessageCloseServerPacket, TalkServerServerPacket } from 'eolib';
import { createServer as createHttpServer, STATUS_CODES, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { createServer, type Server as NetServer, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { WebSocketServer } from 'ws';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pruneExpiredSessions } from './account/accounts.ts';
import { findActiveBan } from './account/bans.ts';
import {
  SlidingWindowLimiter,
  SmtpMailer,
  defaultEmailTemplates,
  loadEmailTemplates,
  type EmailTemplates,
  type Mailer,
} from './account/email.ts';
import { configurePasswordHashing } from './account/password.ts';
import { AuthThrottle } from './account/throttle.ts';
import type { Character } from './character/character.ts';
import { configFilePath, loadConfig, type Config } from './config.ts';
import { ArenaTable } from './data/arenas.ts';
import { DropTables } from './data/drops.ts';
import { Formulas } from './data/formulas.ts';
import { checkGameData, gameDataError, missingClientPubs } from './data/game-data.ts';
import { generatePubs } from './data/generate-pub.ts';
import { PubData } from './data/pub-data.ts';
import { createDatabase, migrateToLatest } from './db/database.ts';
import type { DB } from './db/schema.ts';
import { lang, loadLang } from './lang.ts';
import { log, setLogLevel } from './log.ts';
import { ConnectionLog, isLoopback } from './net/connection-log.ts';
import { addressMatcher, normalizeIp } from './net/ip.ts';
import { SlnPinger, type SlnStatus } from './net/sln.ts';
import { AdminApi } from './admin/api.ts';
import { loadMutes } from './admin/mutes.ts';
import type { ReloadTarget } from './admin/reload-targets.ts';
import { MAX_FRAME, TcpGameSocket, WsGameSocket, type GameSocket } from './net/socket.ts';
import type { ServerContext } from './server-context.ts';
import { ClientState } from './player/client-state.ts';
import { Player } from './player/player.ts';
import { QuestDb } from './quest/quest-db.ts';
import { PartyManager } from './world/party.ts';
import { loadMapStates } from './world/map/persistence.ts';
import { SaveQueue, snapshotMaps, writeMapSnapshots } from './save-coordinator.ts';
import { World } from './world/world.ts';

const TICK_SAMPLES = 80;
const SHUTDOWN_WARNINGS = [900, 600, 300, 120, 60, 30, 10, 5, 4, 3, 2, 1];
const SESSION_PRUNE_SECONDS = 3600;
const CLOSE_TIMEOUT_MS = 10_000;
const LISTENER_CLOSE_TIMEOUT_MS = 5_000;
const DRAIN_TIMEOUT_MS = 5_000;
const LOG_PRUNE_SECONDS = 60;

export interface ShutdownState {
  at: number;
  message: string | null;
}

export interface TickStats {
  samples: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
}

interface AccountLock {
  playerId: number;
  confirmed: boolean;
}

export interface GameServerOptions {
  startAdminApi?: boolean;
  configPath?: string;
  requireGameData?: boolean;
}

const LIVE_CONFIG_SECTIONS = [
  'items',
  'map',
  'evacuate',
  'autoPickup',
  'account',
  'character',
  'newCharacter',
  'world',
  'jail',
  'npcs',
  'combat',
  'guild',
  'board',
  'barber',
  'marriage',
  'jukebox',
  'sln',
  'limits',
  'bank',
  'chest',
  'log',
] as const satisfies ReadonlyArray<keyof Config>;

const RESTART_CONFIG_SECTIONS = ['server', 'database', 'smtp', 'admin', 'data', 'mapSaves'] as const satisfies ReadonlyArray<
  keyof Config
>;

export class GameServer implements ServerContext {
  readonly config: Config;
  readonly players = new Map<number, Player>();

  private database: Kysely<DB> | null = null;
  private pubs: PubData = PubData.empty();
  private gameWorld: World = World.empty();
  private newsLines: string[] = [];
  private newsMtime = -1;
  private formulaDb: Formulas = Formulas.empty();
  private dropDb: DropTables = DropTables.empty();
  readonly parties = new PartyManager();
  globalLocked = false;
  readonly startedAt = Date.now();
  mailer: Mailer;
  readonly emailLimiter = new SlidingWindowLimiter(3_600_000);
  readonly authThrottle = new AuthThrottle(() => this.config.account);
  lastSaveAt: number | null = null;
  exitHandler: ((code: number) => void) | null = null;
  private emailTemplateSet: EmailTemplates = defaultEmailTemplates();
  private questDb: QuestDb = QuestDb.empty();
  private readonly accountLocks = new Map<number, AccountLock>();
  private readonly connectionLog = new ConnectionLog();
  private readonly pendingSockets = new Map<GameSocket, number>();
  private readonly upgradeSockets = new Map<Duplex, { ip: string; at: number }>();
  private readonly closingPlayers = new Set<Promise<void>>();
  readonly saves = new SaveQueue();

  private tcpServer: NetServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private secondInterval: NodeJS.Timeout | null = null;
  private saveInterval: NodeJS.Timeout | null = null;
  private sln: SlnPinger | null = null;
  private adminApi: AdminApi | null = null;
  private nextPlayerId = 1;
  private seconds = 0;
  private shutdownPlan: ShutdownState | null = null;
  private lastShutdownWarning = Number.POSITIVE_INFINITY;
  private stopPromise: Promise<void> | null = null;
  private exitPromise: Promise<void> | null = null;
  private readonly tickDurations: number[] = [];
  private tickCursor = 0;
  private lastTickMs = 0;
  private ticks = {
    second: 0,
    npcAct: 0,
    recover: 0,
    npcRecover: 0,
    chestSpawn: 0,
    spike: 0,
    drain: 0,
    quake: 0,
    autoPickup: 0,
  };

  private readonly options: GameServerOptions;

  constructor(config: Config, options: GameServerOptions = {}) {
    this.config = config;
    this.options = options;
    this.mailer = new SmtpMailer(config.smtp);
  }

  get db(): Kysely<DB> {
    if (this.database === null) throw new Error('database not initialized (call start())');
    return this.database;
  }

  get pubData(): PubData {
    return this.pubs;
  }

  get world(): World {
    return this.gameWorld;
  }

  get news(): string[] {
    this.refreshNews();
    return this.newsLines;
  }

  get emailTemplates(): EmailTemplates {
    return this.emailTemplateSet;
  }

  get formulas(): Formulas {
    return this.formulaDb;
  }

  get drops(): DropTables {
    return this.dropDb;
  }

  get shuttingDown(): boolean {
    return this.stopPromise !== null;
  }

  get shutdownState(): ShutdownState | null {
    return this.shutdownPlan === null ? null : { ...this.shutdownPlan };
  }

  get tickStats(): TickStats {
    const samples = this.tickDurations.length;
    if (samples === 0) return { samples: 0, avgMs: 0, maxMs: 0, lastMs: 0 };
    let sum = 0;
    let max = 0;
    for (const ms of this.tickDurations) {
      sum += ms;
      if (ms > max) max = ms;
    }
    return { samples, avgMs: sum / samples, maxMs: max, lastMs: this.lastTickMs };
  }

  getPlayer(playerId: number): Player | undefined {
    return this.players.get(playerId);
  }

  allPlayers(): Iterable<Player> {
    return this.players.values();
  }

  get quests(): QuestDb {
    return this.questDb;
  }

  playerCount(): number {
    return this.accountLocks.size;
  }

  isLoggedIn(accountId: number): boolean {
    return this.accountLocks.has(accountId);
  }

  reserveAccount(accountId: number, playerId: number): boolean {
    if (this.accountLocks.has(accountId)) return false;
    this.accountLocks.set(accountId, { playerId, confirmed: false });
    return true;
  }

  confirmAccount(accountId: number, playerId: number): void {
    const lock = this.accountLocks.get(accountId);
    if (lock?.playerId === playerId) lock.confirmed = true;
  }

  releaseAccount(accountId: number, playerId: number): void {
    if (this.accountLocks.get(accountId)?.playerId === playerId) this.accountLocks.delete(accountId);
  }

  private refreshNews(): void {
    const path = join(this.config.data.dir, 'news.txt');
    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      this.newsLines = [];
      this.newsMtime = -1;
      return;
    }
    if (mtime === this.newsMtime) return;
    try {
      this.newsLines = readFileSync(path, 'utf8').split(/\r?\n/).slice(0, 9);
      this.newsMtime = mtime;
    } catch {
      this.newsLines = [];
    }
  }

  get tcpPort(): number {
    const address = this.tcpServer?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  get wsPort(): number {
    const address = this.httpServer?.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
  }

  async start(): Promise<void> {
    const { server } = this.config;

    setLogLevel(this.config.log.level);
    this.loadLang();
    const dataDir = this.config.data.dir;
    this.pubs = PubData.load(dataDir, this.config.server.generatePub);
    this.formulaDb = Formulas.load(dataDir);
    this.dropDb = DropTables.load(dataDir, this.pubs.eif?.parsed.items.length);
    this.questDb = QuestDb.load(dataDir);
    this.gameWorld = World.load(dataDir, {
      config: this.config,
      pubData: this.pubs,
      formulas: this.formulaDb,
      drops: this.dropDb,
      arenas: ArenaTable.load(dataDir),
      parties: this.parties,
      getPlayer: (id) => this.players.get(id),
    });
    if (this.options.requireGameData ?? true) {
      checkGameData(dataDir, this.pubs, this.gameWorld.mapCount, this.config.server.generatePub);
    }
    this.database = createDatabase(this.config.database);
    await migrateToLatest(this.database, this.config.database.driver);
    const mutes = await loadMutes(this);
    if (mutes > 0) log.info({ cat: 'admin', mutes }, 'active mutes loaded');
    loadMapStates(this.gameWorld.all, this.config.mapSaves);
    this.emailTemplateSet = loadEmailTemplates(this.config.data.dir);
    this.refreshNews();
    const { account } = this.config;
    if ((account.emailValidation || account.recovery) && !this.mailer.configured) {
      log.warn(
        { cat: 'config' },
        'account.email_validation/recovery need [smtp] host and from_address; both stay disabled until configured',
      );
    }

    configurePasswordHashing(() => ({
      concurrency: this.config.account.passwordHashConcurrency,
      queue: this.config.account.passwordHashQueue,
    }));

    this.tcpServer = createServer((socket: Socket) => this.acceptTcp(socket));
    this.tcpServer.on('error', (err) => {
      log.error({ cat: 'connection', err: String(err) }, 'tcp listener error');
    });

    if (server.websocketEnabled) {
      const timeoutMs = server.hangupDelay * 1000;
      this.wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
      this.wsServer.on('error', (err) => {
        log.error({ cat: 'connection', err: String(err) }, 'websocket server error');
      });
      this.httpServer = createHttpServer(
        { headersTimeout: timeoutMs, requestTimeout: timeoutMs, connectionsCheckingInterval: 1000 },
        (_request, response) => {
          response.writeHead(426, { Connection: 'close' });
          response.end();
        },
      );
      this.httpServer.maxConnections = server.maxConnections;
      this.httpServer.on('connection', (socket: Socket) => this.trackUpgradeSocket(socket));
      this.httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        void this.upgrade(request, socket, head);
      });
      this.httpServer.on('clientError', (_err, socket: Duplex) => socket.destroy());
      this.httpServer.on('error', (err) => {
        log.error({ cat: 'connection', err: String(err) }, 'websocket listener error');
      });
    }

    this.pingInterval = setInterval(() => {
      for (const player of this.players.values()) player.ping();
    }, server.pingRate * 1000);

    this.tickInterval = setInterval(() => this.runTick(), this.config.world.tickRate);
    this.secondInterval = setInterval(() => this.everySecond(), 1000);
    if (server.saveRate > 0) {
      this.saveInterval = setInterval(() => void this.periodicSave(), server.saveRate * 60_000);
    }
    void this.pruneSessions();

    this.sln = new SlnPinger(this.config.sln, this.config.server, () => this.playerCount());
    this.sln.start();

    await listen(this.tcpServer, server.host, server.port);
    log.info({ host: server.host, port: server.port }, 'tcp listener started');
    if (this.httpServer !== null) {
      await listen(this.httpServer, server.host, server.websocketPort);
      log.info({ host: server.host, port: server.websocketPort }, 'websocket listener started');
    }

    const startAdminApi = this.options.startAdminApi ?? true;
    if (startAdminApi && this.config.admin.enabled) {
      this.adminApi = new AdminApi(this, this.config.admin);
      await this.adminApi.start();
    }
  }

  get adminApiPort(): number | null {
    return this.adminApi?.port ?? null;
  }

  get slnStatus(): SlnStatus {
    return (
      this.sln?.status ?? { enabled: this.config.sln.enabled, lastPingAt: null, lastResult: null, lastError: null }
    );
  }

  pingSln(): Promise<SlnStatus> {
    if (this.sln === null) {
      this.sln = new SlnPinger(this.config.sln, this.config.server, () => this.playerCount());
    }
    return this.sln.pingNow();
  }

  async reload(target: ReloadTarget): Promise<string> {
    const dir = this.config.data.dir;
    switch (target) {
      case 'maps': {
        let reloaded = 0;
        let failed = 0;
        for (const map of this.gameWorld.all) {
          if (map.reloadFromDisk(dir)) reloaded++;
          else failed++;
        }
        return `reloaded ${reloaded} map${reloaded === 1 ? '' : 's'}${failed > 0 ? ` (${failed} failed)` : ''}`;
      }
      case 'pubs': {
        const fresh = PubData.load(dir, this.config.server.generatePub);
        const missing = missingClientPubs(fresh);
        if (missing.length > 0) throw gameDataError(dir, missing, this.config.server.generatePub);
        this.pubs = fresh;
        for (const map of this.gameWorld.all) map.deps.pubData = this.pubs;
        if (this.config.server.generatePub) {
          this.dropDb = DropTables.load(dir, this.pubs.eif?.parsed.items.length);
          for (const map of this.gameWorld.all) map.deps.drops = this.dropDb;
        }
        this.recalculateOnlineStats();
        const pub = this.pubs;
        return (
          `items ${pub.eif?.length ?? 0}, npcs ${pub.enf?.length ?? 0}, spells ${pub.esf?.length ?? 0}, ` +
          `classes ${pub.ecf?.length ?? 0}; players must relog to download the new files`
        );
      }
      case 'shops': {
        const fresh = PubData.load(dir, this.config.server.generatePub);
        const merged = Object.assign(Object.create(PubData.prototype) as PubData, this.pubs, {
          shops: fresh.shops,
          skillMasters: fresh.skillMasters,
          inns: fresh.inns,
          talk: fresh.talk,
        });
        this.pubs = merged;
        for (const map of this.gameWorld.all) map.deps.pubData = merged;
        return (
          `shops ${merged.shops?.shops.length ?? 0}, skill masters ${merged.skillMasters?.skillMasters.length ?? 0}, ` +
          `inns ${merged.inns?.inns.length ?? 0}, talk ${merged.talk?.npcs.length ?? 0}`
        );
      }
      case 'drops': {
        if (this.config.server.generatePub) generatePubs(dir);
        this.dropDb = DropTables.load(dir, this.pubs.eif?.parsed.items.length);
        for (const map of this.gameWorld.all) map.deps.drops = this.dropDb;
        return `${this.dropDb.global.length} global drops loaded`;
      }
      case 'quests': {
        this.questDb = QuestDb.load(dir);
        return 'quests reloaded';
      }
      case 'formulas': {
        this.formulaDb = Formulas.load(dir);
        for (const map of this.gameWorld.all) map.deps.formulas = this.formulaDb;
        this.recalculateOnlineStats();
        return 'formulas reloaded';
      }
      case 'news': {
        this.newsMtime = -1;
        this.refreshNews();
        return `${this.newsLines.length} news line${this.newsLines.length === 1 ? '' : 's'}`;
      }
      case 'config':
        return this.reloadConfig();
      default:
        throw new Error(`unknown reload target ${String(target)}`);
    }
  }

  private recalculateOnlineStats(): void {
    for (const player of this.players.values()) {
      player.character?.calculateStats(this.formulaDb, this.pubs, this.config.combat);
    }
  }

  private loadLang(): void {
    loadLang(this.options.configPath ?? configFilePath(), this.config.server.lang);
  }

  private reloadConfig(): string {
    const fresh = loadConfig(this.options.configPath);
    this.config.server.lang = fresh.server.lang;
    this.loadLang();
    const tickRate = this.config.world.tickRate;
    const slnBefore = JSON.stringify(this.config.sln);
    for (const section of LIVE_CONFIG_SECTIONS) {
      Object.assign(this.config[section], fresh[section]);
    }
    const notes: string[] = [];
    if (fresh.world.tickRate !== tickRate) {
      this.config.world.tickRate = tickRate;
      notes.push('world.tick_rate needs a restart');
    }
    setLogLevel(this.config.log.level);
    if (JSON.stringify(this.config.sln) !== slnBefore) {
      if (this.sln === null) {
        this.sln = new SlnPinger(this.config.sln, this.config.server, () => this.playerCount());
      }
      this.sln.restart();
    }
    const changedRestart = RESTART_CONFIG_SECTIONS.filter(
      (section) => JSON.stringify(this.config[section]) !== JSON.stringify(fresh[section]),
    );
    if (changedRestart.length > 0) notes.push(`restart needed for: ${changedRestart.join(', ')}`);
    return `updated ${LIVE_CONFIG_SECTIONS.join(', ')}, lang (${this.config.server.lang})${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`;
  }

  private get connectionCount(): number {
    return this.players.size + this.pendingSockets.size + this.upgradeSockets.size;
  }

  private isTrustedProxy(ip: string): boolean {
    const { server } = this.config;
    return server.trustProxy && addressMatcher(server.trustedProxies).matches(ip);
  }

  private admissionError(ip: string, now: number): string | null {
    const { server } = this.config;
    if (server.ipReconnectLimit > 0 && !isLoopback(ip)) {
      const lastConnect = this.connectionLog.lastConnect(ip);
      if (lastConnect !== undefined && now - lastConnect < server.ipReconnectLimit * 1000) {
        return 'reconnected too quickly';
      }
    }
    if (server.maxConnectionsPerIp > 0 && this.connectionLog.connections(ip) >= server.maxConnectionsPerIp) {
      return 'too many connections from ip';
    }
    return null;
  }

  private acceptTcp(socket: Socket): void {
    const peer = normalizeIp(socket.remoteAddress);
    if (peer === null) {
      socket.destroy();
      return;
    }
    this.accept(new TcpGameSocket(socket, this.isTrustedProxy(peer), this.config.limits.maxSendBuffer));
  }

  private trackUpgradeSocket(socket: Socket): void {
    const { server } = this.config;
    const ip = normalizeIp(socket.remoteAddress);
    if (ip === null || this.shuttingDown || this.connectionCount >= server.maxConnections) {
      socket.destroy();
      return;
    }
    if (server.maxConnectionsPerIp > 0 && !this.isTrustedProxy(ip)) {
      let fromIp = this.connectionLog.connections(ip);
      for (const pending of this.upgradeSockets.values()) if (pending.ip === ip) fromIp++;
      if (fromIp >= server.maxConnectionsPerIp) {
        socket.destroy();
        return;
      }
    }
    this.upgradeSockets.set(socket, { ip, at: Date.now() });
    socket.once('close', () => this.upgradeSockets.delete(socket));
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const pending = this.upgradeSockets.get(socket);
    const wsServer = this.wsServer;
    if (pending === undefined || wsServer === null || this.shuttingDown) {
      socket.destroy();
      return;
    }
    let ip: string | undefined = pending.ip;
    if (this.isTrustedProxy(pending.ip)) {
      ip = forwardedFor(request.headers['x-forwarded-for'], request.headers['x-real-ip']);
      if (ip === undefined) {
        log.warn({ cat: 'connection', proxy: pending.ip }, 'rejecting websocket: missing client address from trusted proxy');
        rejectUpgrade(socket, 400);
        return;
      }
    }
    const refusal = this.admissionError(ip, Date.now());
    if (refusal !== null) {
      log.warn({ cat: 'connection', ip }, `rejecting websocket: ${refusal}`);
      rejectUpgrade(socket, 503);
      return;
    }
    let banned = false;
    try {
      banned = (await findActiveBan(this.db, { ip })) !== null;
    } catch (err) {
      log.error({ cat: 'connection', ip, err: String(err) }, 'ban lookup failed');
    }
    if (banned) {
      log.warn({ cat: 'connection', ip }, 'rejecting websocket: banned');
      rejectUpgrade(socket, 403);
      return;
    }
    if (socket.destroyed || this.shuttingDown) {
      socket.destroy();
      return;
    }
    const address = ip;
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.upgradeSockets.delete(socket);
      this.accept(new WsGameSocket(ws, address, this.config.limits.maxSendBuffer));
    });
  }

  private accept(socket: GameSocket): void {
    if (this.shuttingDown) {
      socket.destroy();
      return;
    }

    if (this.connectionCount >= this.config.server.maxConnections) {
      log.warn({ ip: socket.remoteAddress }, 'rejecting connection: server full');
      socket.destroy();
      return;
    }

    if (socket.ready) {
      this.admit(socket);
      return;
    }

    this.pendingSockets.set(socket, Date.now());
    socket.onClose(() => this.pendingSockets.delete(socket));
    socket.onReady(() => {
      this.pendingSockets.delete(socket);
      this.admit(socket);
    });
  }

  private admit(socket: GameSocket): void {
    const ip = socket.remoteAddress;
    const now = Date.now();

    if (this.shuttingDown) {
      socket.destroy();
      return;
    }

    const refusal = this.admissionError(ip, now);
    if (refusal !== null) {
      log.warn({ ip }, `rejecting connection: ${refusal}`);
      socket.destroy();
      return;
    }

    this.connectionLog.add(ip, now);
    const id = this.allocatePlayerId();
    const player = new Player(id, socket, this, (p) => {
      this.players.delete(p.id);
      this.connectionLog.remove(ip);
      const closing = p.closing;
      this.closingPlayers.add(closing);
      void closing.finally(() => this.closingPlayers.delete(closing));
    });
    this.players.set(id, player);
    log.info({ player: id, ip, online: this.players.size }, 'connection accepted');
  }

  private allocatePlayerId(): number {
    for (let i = 0; i < 64000; i++) {
      const candidate = ((this.nextPlayerId + i - 1) % 64000) + 1;
      if (!this.players.has(candidate)) {
        this.nextPlayerId = (candidate % 64000) + 1;
        return candidate;
      }
    }
    throw new Error('no free player ids');
  }

  private runTick(): void {
    const started = performance.now();
    try {
      this.tick();
    } catch (err) {
      log.error({ cat: 'server', err: err instanceof Error ? err.stack : String(err) }, 'tick failed');
    } finally {
      this.recordTick(performance.now() - started);
    }
  }

  private recordTick(ms: number): void {
    if (this.tickDurations.length < TICK_SAMPLES) this.tickDurations.push(ms);
    else this.tickDurations[this.tickCursor] = ms;
    this.tickCursor = (this.tickCursor + 1) % TICK_SAMPLES;
    this.lastTickMs = ms;
  }

  private everySecond(): void {
    const now = Date.now();
    const { server, world } = this.config;

    for (const player of this.players.values()) {
      const expired = player.idleExpiry(now, server);
      if (expired !== null) {
        player.close(expired);
        continue;
      }
      player.bus.rateLimiter.prune(now);
      if (player.state === ClientState.InGame && player.character !== null) {
        player.usageTicks = Math.max(0, player.usageTicks - 1);
        if (player.usageTicks === 0) {
          player.character.row.usage += 1;
          player.usageTicks = world.usageRate;
        }
      }
    }

    for (const [socket, connectedAt] of this.pendingSockets) {
      if (now - connectedAt > server.hangupDelay * 1000) {
        this.pendingSockets.delete(socket);
        socket.destroy();
      }
    }

    for (const [socket, pending] of this.upgradeSockets) {
      if (now - pending.at > server.hangupDelay * 1000) {
        this.upgradeSockets.delete(socket);
        socket.destroy();
      }
    }

    this.seconds++;
    if (this.seconds % LOG_PRUNE_SECONDS === 0) {
      this.emailLimiter.prune(now);
      this.authThrottle.prune(now);
      this.connectionLog.prune(now, server.ipReconnectLimit * 1000);
    }
    if (this.seconds % SESSION_PRUNE_SECONDS === 0) void this.pruneSessions();
    this.tickShutdown(now);
  }

  private async pruneSessions(): Promise<void> {
    try {
      const pruned = await pruneExpiredSessions(this.db);
      if (pruned > 0) log.info({ cat: 'server', pruned }, 'expired sessions pruned');
    } catch (err) {
      log.error({ cat: 'server', err: String(err) }, 'failed to prune sessions');
    }
  }

  private async periodicSave(): Promise<void> {
    try {
      const saved = await this.saveAll();
      log.info({ cat: 'server', saved }, 'periodic save complete');
    } catch (err) {
      log.error({ cat: 'server', err: String(err) }, 'periodic save failed');
    }
  }

  saveAll(): Promise<number> {
    return this.saves.run(() => this.persistWorld());
  }

  private async persistWorld(): Promise<number> {
    const characters: Character[] = [];
    for (const player of this.players.values()) {
      if (player.state === ClientState.InGame && player.character !== null) {
        characters.push(player.character);
      }
    }
    const pending = characters.map(async (c) => c.save(this.db));
    const maps = snapshotMaps(this.gameWorld.all, this.config.mapSaves);
    const results = await Promise.allSettled(pending);
    let saved = 0;
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') saved++;
      else {
        log.error(
          { cat: 'server', character: characters[i]?.name, err: String(result.reason) },
          'failed to save character',
        );
      }
    });
    await writeMapSnapshots(maps, this.config.mapSaves.dir);
    this.lastSaveAt = Date.now();
    return saved;
  }

  announce(message: string): void {
    const packet = new TalkServerServerPacket();
    packet.message = message;
    for (const player of this.players.values()) {
      if (player.state !== ClientState.InGame) continue;
      try {
        player.bus.send(packet);
      } catch (err) {
        log.error({ player: player.id, err: String(err) }, 'failed to send announcement');
      }
    }
  }

  scheduleShutdown(seconds: number, message?: string): ShutdownState {
    const delay = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    const trimmed = message?.trim() ?? '';
    const plan: ShutdownState = { at: Date.now() + delay * 1000, message: trimmed === '' ? null : trimmed };
    this.shutdownPlan = plan;
    this.lastShutdownWarning = delay;
    log.warn({ cat: 'server', seconds: delay, message: plan.message }, 'shutdown scheduled');
    if (delay === 0) {
      void this.shutdown(0, 'scheduled shutdown');
    } else {
      this.announce(shutdownWarning(delay, plan.message));
    }
    return { ...plan };
  }

  cancelShutdown(): boolean {
    if (this.shutdownPlan === null || this.shuttingDown) return false;
    this.shutdownPlan = null;
    this.lastShutdownWarning = Number.POSITIVE_INFINITY;
    log.warn({ cat: 'server' }, 'scheduled shutdown cancelled');
    this.announce(lang('shutdown_cancelled'));
    return true;
  }

  private tickShutdown(now: number): void {
    const plan = this.shutdownPlan;
    if (plan === null || this.shuttingDown) return;
    const remaining = Math.ceil((plan.at - now) / 1000);
    if (remaining <= 0) {
      void this.shutdown(0, 'scheduled shutdown');
      return;
    }
    if (SHUTDOWN_WARNINGS.some((t) => remaining <= t && t < this.lastShutdownWarning)) {
      this.lastShutdownWarning = remaining;
      this.announce(shutdownWarning(remaining, plan.message));
    }
  }

  shutdown(code = 0, reason = 'shutdown'): Promise<void> {
    if (this.exitPromise !== null) return this.exitPromise;
    this.exitPromise = (async () => {
      log.info({ cat: 'server', reason, code }, 'shutting down');
      let exitCode = code;
      try {
        await this.stop();
      } catch (err) {
        log.error({ cat: 'server', err: String(err) }, 'error during shutdown');
        if (exitCode === 0) exitCode = 1;
      }
      this.exitHandler?.(exitCode);
    })();
    return this.exitPromise;
  }

  private tick(): void {
    const { world, npcs } = this.config;
    this.ticks.second++;
    this.ticks.npcAct++;
    this.ticks.recover++;
    this.ticks.npcRecover++;
    this.ticks.chestSpawn++;
    this.ticks.spike++;
    this.ticks.drain++;
    this.ticks.quake++;

    const second = this.ticks.second >= 8;
    const npcAct = this.ticks.npcAct >= npcs.actRate;
    const recover = this.ticks.recover >= world.recoverRate;
    const npcRecover = this.ticks.npcRecover >= world.npcRecoverRate;
    const chestSpawn = this.ticks.chestSpawn >= world.chestSpawnRate;
    const spike = this.ticks.spike >= world.spikeRate;
    const drain = this.ticks.drain >= world.drainRate;
    const quake = this.ticks.quake >= world.quakeRate;
    const pickup = this.config.autoPickup;
    if (pickup.enabled) this.ticks.autoPickup++;
    const autoPickup = pickup.enabled && this.ticks.autoPickup >= pickup.rate;

    const events = { second, npcAct, recover, npcRecover, chestSpawn, spike, drain, quake, autoPickup };
    for (const map of this.gameWorld.all) map.tick(events);

    if (second) this.ticks.second = 0;
    if (npcAct) this.ticks.npcAct = 0;
    if (recover) this.ticks.recover = 0;
    if (npcRecover) this.ticks.npcRecover = 0;
    if (chestSpawn) this.ticks.chestSpawn = 0;
    if (spike) this.ticks.spike = 0;
    if (drain) this.ticks.drain = 0;
    if (quake) this.ticks.quake = 0;
    if (autoPickup) this.ticks.autoPickup = 0;
  }

  stop(): Promise<void> {
    if (this.stopPromise === null) this.stopPromise = this.gracefulStop();
    return this.stopPromise;
  }

  private async saveAndClosePlayers(): Promise<void> {
    const characters = [...this.players.values()].filter(
      (p) => p.state === ClientState.InGame && p.character !== null,
    ).length;
    const maps = this.database === null ? [] : snapshotMaps(this.gameWorld.all, this.config.mapSaves);
    for (const player of [...this.players.values()]) player.close('server shutting down');
    await withTimeout(Promise.allSettled([...this.closingPlayers]), CLOSE_TIMEOUT_MS);
    if (this.database === null) return;
    try {
      const savedMaps = await writeMapSnapshots(maps, this.config.mapSaves.dir);
      this.lastSaveAt = Date.now();
      log.info({ cat: 'server', characters, maps: savedMaps }, 'world saved before shutdown');
    } catch (err) {
      log.error({ cat: 'server', err: String(err) }, 'failed to save maps before shutdown');
    }
  }

  private async gracefulStop(): Promise<void> {
    for (const timer of [this.pingInterval, this.tickInterval, this.secondInterval, this.saveInterval]) {
      if (timer !== null) clearInterval(timer);
    }
    this.sln?.stop();

    const tcpClosed = new Promise<void>((resolve) => {
      if (this.tcpServer === null) return resolve();
      this.tcpServer.close(() => resolve());
    });
    const wsClosed = new Promise<void>((resolve) => {
      const http = this.httpServer;
      if (http === null) return resolve();
      this.wsServer?.close();
      http.close(() => resolve());
      http.closeAllConnections();
    });
    for (const socket of this.pendingSockets.keys()) socket.destroy();
    this.pendingSockets.clear();
    for (const socket of this.upgradeSockets.keys()) socket.destroy();
    this.upgradeSockets.clear();

    const closePacket = new MessageCloseServerPacket();
    for (const player of this.players.values()) {
      if (player.state === ClientState.Uninitialized) continue;
      try {
        player.bus.send(closePacket);
      } catch (err) {
        log.error({ player: player.id, err: String(err) }, 'failed to send close message');
      }
    }

    await withTimeout(Promise.allSettled([...this.players.values()].map((p) => p.drain())), DRAIN_TIMEOUT_MS);
    await withTimeout(this.saves.idle(), CLOSE_TIMEOUT_MS);
    await this.saveAndClosePlayers();

    try {
      await this.adminApi?.stop();
    } catch (err) {
      log.error({ cat: 'server', err: String(err) }, 'failed to stop admin api');
    }
    await withTimeout(Promise.all([tcpClosed, wsClosed]), LISTENER_CLOSE_TIMEOUT_MS);
    this.mailer.close();
    await this.database?.destroy();
    log.info('server stopped');
  }
}

function listen(listener: NetServer | HttpServer, host: string, port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(port, host, () => {
      listener.off('error', reject);
      resolve();
    });
  });
}

function rejectUpgrade(socket: Duplex, status: number): void {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function withTimeout(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const parts: string[] = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (rest > 0 || minutes === 0) parts.push(`${rest} second${rest === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function shutdownWarning(seconds: number, message: string | null): string {
  const base = lang('shutdown_warning', { time: formatDuration(seconds), seconds });
  return message === null ? base : `${base} ${message}`;
}

export function forwardedFor(
  xff: string | string[] | undefined,
  xRealIp: string | string[] | undefined,
): string | undefined {
  const value = Array.isArray(xff) ? xff.join(',') : xff;
  if (value !== undefined && value.trim() !== '') {
    const last = value.split(',').map((part) => part.trim()).filter((part) => part !== '').at(-1);
    return normalizeIp(last) ?? undefined;
  }
  const real = Array.isArray(xRealIp) ? xRealIp.at(-1) : xRealIp;
  return normalizeIp(real) ?? undefined;
}
