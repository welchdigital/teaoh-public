import {
  ConnectionPlayerServerPacket,
  EoReader,
  ItemAcceptServerPacket,
  PacketAction,
  PacketFamily,
  PingSequenceStart,
  RecoverPlayerServerPacket,
  RecoverReplyServerPacket,
  Version,
  WarpEffect,
  WarpRequestServerPacket,
  WarpType,
} from 'eolib';
import { randomInt } from 'node:crypto';
import type { EmailPin } from '../account/email.ts';
import type { Character } from '../character/character.ts';
import type { ServerConfig } from '../config.ts';
import {
  CaptchaAgreeServerPacket,
  CaptchaCloseServerPacket,
  CaptchaOpenServerPacket,
  FAMILY_CAPTCHA,
} from '../deep/index.ts';
import { respawnLocation } from '../character/spawn-location.ts';
import type { GameMap } from '../world/map/game-map.ts';
import { broadcastPartyHp } from '../world/map/party-hp.ts';
import { log } from '../log.ts';
import { PacketBus } from '../net/packet-bus.ts';
import { rateLimitTable } from '../net/rate-limits.ts';
import type { GameSocket } from '../net/socket.ts';
import type { ServerContext } from '../server-context.ts';
import { ClientState } from './client-state.ts';
import { handleCaptcha } from './handlers/captcha.ts';
import { handlers } from './handlers/index.ts';
import { leaveParty } from './handlers/party.ts';
import { cancelTrade } from './handlers/trade.ts';

export class Player {
  readonly id: number;
  readonly bus: PacketBus;
  readonly server: ServerContext;
  state: ClientState = ClientState.Uninitialized;
  version: Version = new Version();
  accountId = 0;
  loginAttempts = 0;
  hdid = '';
  readonly connectedAt = Date.now();
  character: Character | null = null;
  map: GameMap | null = null;
  warpSession: {
    mapId: number;
    x: number;
    y: number;
    local: boolean;
    effect: number;
    sessionId: number;
    requestedAt: number;
  } | null = null;
  timestamp = 0;
  openShopId: number | null = null;
  bankOpen = false;
  partyRequest: { requestType: number; fromPlayerId: number } | null = null;
  trade: { partnerId: number; items: import('eolib').Item[]; agreed: boolean } | null = null;
  tradeRequestTo: number | null = null;
  interactNpcIndex: number | null = null;
  interactPlayerId: number | null = null;
  guildCreateMembers: number[] = [];
  sleepCost = 0;
  frozen = false;
  muted = false;
  warpSuckTicks = 15;
  captcha: { challenge: string; reward: number; attempts: number } | null = null;
  skillMasterId: number | null = null;
  openChestKey: string | null = null;
  spellChant: { spellId: number; timestamp: number; startedAt: number } | null = null;
  isDying = false;
  usageTicks = 0;
  emailPin: EmailPin | null = null;
  accountsCreated = 0;
  lastAccountCreateAt: number | null = null;
  closing: Promise<void> = Promise.resolve();

  private sessionId: number | null = null;
  private readonly onCloseCb: (player: Player) => void;
  private isClosed = false;
  private lockedAccountId = 0;
  private queuedPackets = 0;
  private handlerChain: Promise<void> = Promise.resolve();

  constructor(
    id: number,
    socket: GameSocket,
    server: ServerContext,
    onClose: (player: Player) => void,
  ) {
    this.id = id;
    this.server = server;
    this.onCloseCb = onClose;
    this.bus = new PacketBus(socket);
    socket.onPayload((payload) => this.handlePayload(payload));
    socket.onClose(() => this.close('socket closed'));
  }

  get config() {
    return this.server.config;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  get isDeep(): boolean {
    return this.version.minor > 0;
  }

  get ip(): string {
    return this.bus.socket.remoteAddress;
  }

  get pendingPackets(): number {
    return this.queuedPackets;
  }

  generateSessionId(): number {
    this.sessionId = randomInt(10, 64008);
    return this.sessionId;
  }

  takeSessionId(): number | null {
    const sessionId = this.sessionId;
    this.sessionId = null;
    return sessionId;
  }

  peekSessionId(): number | null {
    return this.sessionId;
  }

  reserveAccount(accountId: number): boolean {
    if (this.isClosed || this.lockedAccountId !== 0) return false;
    if (!this.server.reserveAccount(accountId, this.id)) return false;
    this.lockedAccountId = accountId;
    return true;
  }

  releaseAccountReservation(): void {
    if (this.lockedAccountId === 0 || this.accountId === this.lockedAccountId) return;
    this.server.releaseAccount(this.lockedAccountId, this.id);
    this.lockedAccountId = 0;
  }

  confirmLogin(accountId: number): boolean {
    if (this.isClosed || this.lockedAccountId !== accountId) return false;
    this.server.confirmAccount(accountId, this.id);
    this.accountId = accountId;
    return true;
  }

  private handlePayload(payload: Uint8Array): void {
    if (this.isClosed || this.server.shuttingDown) return;
    try {
      const data = this.bus.decrypt(payload);
      const reader = new EoReader(data);
      const action = reader.getByte();
      const family = reader.getByte();

      if (PacketAction[action] === undefined && action !== 220) {
        this.close(`invalid packet action ${action}`);
        return;
      }
      if (PacketFamily[family] === undefined && family !== FAMILY_CAPTCHA) {
        this.close(`invalid packet family ${family}`);
        return;
      }

      if (family === PacketFamily.Init) {
        this.bus.sequencer.nextSequence();
      } else if (this.state !== ClientState.Uninitialized) {
        if (
          family === PacketFamily.Connection &&
          action === PacketAction.Ping &&
          this.bus.upcomingSequenceStart !== null
        ) {
          this.bus.sequencer.sequenceStart = this.bus.upcomingSequenceStart;
          this.bus.upcomingSequenceStart = null;
        }

        const serverSequence = this.bus.sequencer.nextSequence();
        const clientSequence = serverSequence >= 253 ? reader.getShort() : reader.getChar();
        if (this.config.server.enforceSequence && clientSequence !== serverSequence) {
          this.close(`invalid sequence: got ${clientSequence}, expected ${serverSequence}`);
          return;
        }
      }

      if (
        this.bus.rateLimiter.shouldDrop(
          family,
          action,
          rateLimitTable(this.config.limits.packetRateLimits),
          Date.now(),
        )
      ) {
        return;
      }

      if (log.isLevelEnabled('debug')) {
        log.debug(
          { player: this.id, family: PacketFamily[family] ?? family, action: PacketAction[action] ?? action },
          'recv',
        );
      }

      if (family === FAMILY_CAPTCHA) {
        this.enqueue(() => handleCaptcha(this, action, reader));
        return;
      }

      const handler = handlers.get(family);
      if (handler === undefined) {
        log.debug({ player: this.id, family, action }, 'unhandled packet family');
        return;
      }

      this.enqueue(() => handler(this, action, reader));
    } catch (err) {
      this.safeClose(`error handling packet: ${String(err)}`);
    }
  }

  private enqueue(run: () => void | Promise<void>): void {
    if (this.queuedPackets >= this.config.limits.maxQueuedPackets) {
      this.safeClose(`packet queue overflow (${this.queuedPackets} pending)`);
      return;
    }
    this.queuedPackets++;
    this.handlerChain = this.handlerChain
      .then(async () => {
        try {
          if (this.isClosed || this.server.shuttingDown) return;
          await run();
        } catch (err) {
          this.safeClose(`error handling packet: ${String(err)}`);
        } finally {
          this.queuedPackets--;
        }
      })
      .catch(() => undefined);
  }

  private safeClose(reason: string): void {
    try {
      this.close(reason);
    } catch (err) {
      log.error({ player: this.id, err: String(err) }, 'error during close');
    }
  }

  clearInteractions(): void {
    this.openShopId = null;
    this.bankOpen = false;
    this.interactNpcIndex = null;
    this.skillMasterId = null;
    this.sleepCost = 0;
    this.openChestKey = null;
  }

  drain(): Promise<void> {
    return this.handlerChain;
  }

  requestWarp(mapId: number, x: number, y: number, local: boolean, effect = WarpEffect.None): void {
    if (this.trade !== null || this.tradeRequestTo !== null) cancelTrade(this, true);
    this.clearInteractions();
    const target = local ? undefined : this.server.world.getMap(mapId);
    if (!local && target === undefined && this.map !== null) {
      log.warn({ cat: 'warp', player: this.id, map: mapId }, 'ignoring a warp to a missing map');
      return;
    }
    const sessionId = randomInt(10, 64008);
    this.warpSession = { mapId, x, y, local, effect, sessionId, requestedAt: Date.now() };

    const request = new WarpRequestServerPacket();
    request.sessionId = sessionId;
    request.mapId = mapId;
    if (local) {
      request.warpType = WarpType.Local;
    } else {
      request.warpType = WarpType.MapSwitch;
      const data = new WarpRequestServerPacket.WarpTypeDataMapSwitch();
      data.mapRid = target?.rid ?? [0, 0];
      data.mapFileSize = target?.fileSize ?? 0;
      request.warpTypeData = data;
    }
    this.bus.send(request);
  }

  die(): void {
    const character = this.character;
    const map = this.map;
    if (character === null || map === null || this.isDying) return;
    this.isDying = true;
    log.info(
      { cat: 'death', player: this.id, character: character.name, map: map.id },
      'player died',
    );
    this.spellChant = null;
    if (this.trade !== null) cancelTrade(this, true);
    const world = this.server.world;
    const spawn = respawnLocation(
      character,
      this.server.pubData,
      this.config.world,
      (mapId) => world.getMap(mapId) !== undefined,
    );
    map.leave(this.id);
    this.map = null;
    character.mapId = 0;
    this.requestWarp(spawn.map, spawn.x, spawn.y, false);
  }

  arenaDie(x: number, y: number): void {
    const character = this.character;
    const map = this.map;
    if (character === null || map === null || this.isDying) return;
    this.spellChant = null;
    if (this.trade !== null) cancelTrade(this, true);
    map.leave(this.id);
    this.map = null;
    character.setCoords(x, y);
    this.requestWarp(map.id, x, y, false);
  }

  respawn(): void {
    const character = this.character;
    if (!this.isDying || character === null) return;
    this.isDying = false;
    character.row.hp = character.maxHp;
    this.sendRecover();
    if (this.map !== null) broadcastPartyHp(this.map, character);
  }

  showCaptcha(reward: number): void {
    if (!this.isDeep) return;
    const challenge = Array.from({ length: 5 }, () =>
      String.fromCharCode(65 + randomInt(0, 26)),
    ).join('');
    this.captcha = { challenge, reward, attempts: 0 };

    const packet = new CaptchaOpenServerPacket();
    packet.id = 1;
    packet.rewardExp = reward;
    packet.captcha = challenge;
    this.bus.send(packet);
  }

  refreshCaptcha(): void {
    if (this.captcha === null) return;
    this.captcha.challenge = Array.from({ length: 5 }, () =>
      String.fromCharCode(65 + randomInt(0, 26)),
    ).join('');
    this.captcha.attempts = 0;

    const packet = new CaptchaAgreeServerPacket();
    packet.id = 1;
    packet.captcha = this.captcha.challenge;
    this.bus.send(packet);
  }

  answerCaptcha(answer: string): void {
    if (this.captcha === null || this.character === null) return;
    this.captcha.attempts++;
    if (this.captcha.attempts > 5) return;
    if (answer !== this.captcha.challenge) return;

    const reward = this.captcha.reward;
    this.captcha = null;
    const character = this.character;
    const leveled = character.addExperience(
      reward,
      this.server.formulas,
      this.config.world.statPointsPerLevel,
      this.config.world.skillPointsPerLevel,
    );
    if (leveled) {
      const hp = character.row.hp;
      const maxHp = character.maxHp;
      character.calculateStats(this.server.formulas, this.server.pubData, this.config.combat);
      if (this.map !== null && (character.row.hp !== hp || character.maxHp !== maxHp)) {
        broadcastPartyHp(this.map, character);
      }
    }

    const packet = new CaptchaCloseServerPacket();
    packet.experience = character.row.experience;
    this.bus.send(packet);

    if (!leveled) return;
    const reply = new RecoverReplyServerPacket();
    reply.experience = character.row.experience;
    reply.karma = character.row.karma;
    reply.levelUp = character.row.level;
    reply.statPoints = character.row.stat_points;
    reply.skillPoints = character.row.skill_points;
    this.bus.send(reply);

    const levelUp = new ItemAcceptServerPacket();
    levelUp.playerId = this.id;
    this.map?.broadcastNear(levelUp, character.row.x, character.row.y, this.id);
  }

  sendRecover(): void {
    if (this.character === null) return;
    const packet = new RecoverPlayerServerPacket();
    packet.hp = this.character.row.hp;
    packet.tp = this.character.row.tp;
    this.bus.send(packet);
  }

  ping(): void {
    if (this.state === ClientState.Uninitialized || this.isClosed) return;
    if (this.bus.needPong) {
      this.close('ping timeout');
      return;
    }
    this.bus.needPong = true;
    this.sendConnectionPing();
  }

  handshakeExpired(now: number, hangupDelaySeconds: number): boolean {
    return this.state === ClientState.Uninitialized && now - this.connectedAt > hangupDelaySeconds * 1000;
  }

  idleExpiry(now: number, server: ServerConfig): string | null {
    const age = now - this.connectedAt;
    if (this.handshakeExpired(now, server.hangupDelay)) {
      return `failed to start handshake in ${server.hangupDelay} seconds`;
    }
    if (server.acceptTimeout > 0 && this.state < ClientState.Accepted && age > server.acceptTimeout * 1000) {
      return `failed to complete the handshake in ${server.acceptTimeout} seconds`;
    }
    if (server.loginTimeout > 0 && this.state < ClientState.InGame && age > server.loginTimeout * 1000) {
      return `did not enter the game within ${server.loginTimeout} seconds`;
    }
    return null;
  }

  private sendConnectionPing(): void {
    const start = PingSequenceStart.generate();
    this.bus.upcomingSequenceStart = start;
    const packet = new ConnectionPlayerServerPacket();
    packet.seq1 = start.seq1;
    packet.seq2 = start.seq2;
    this.bus.send(packet);
  }

  private cleanupStep(step: string, run: () => void): void {
    try {
      run();
    } catch (err) {
      log.error({ player: this.id, step, err: String(err) }, 'error during close');
    }
  }

  private saveOnClose(character: Character): Promise<void> {
    try {
      return character.save(this.server.db).catch((err: unknown) => {
        log.error({ player: this.id, err: String(err) }, 'failed to save character on close');
      });
    } catch (err) {
      log.error({ player: this.id, err: String(err) }, 'failed to save character on close');
      return Promise.resolve();
    }
  }

  close(reason: string): void {
    if (this.isClosed) return;
    this.isClosed = true;
    log.info({ cat: 'connection', player: this.id, ip: this.ip, reason }, 'closing connection');

    this.cleanupStep('leave party', () => leaveParty(this.server, this.id));
    this.cleanupStep('cancel trade', () => cancelTrade(this, true));
    const map = this.map;
    if (map !== null) {
      this.cleanupStep('leave map', () => map.leave(this.id));
      this.map = null;
    }

    const character = this.character;
    this.character = null;
    const saved = character === null ? Promise.resolve() : this.saveOnClose(character);

    this.cleanupStep('close socket', () => this.bus.socket.end());

    const accountId = this.lockedAccountId;
    this.lockedAccountId = 0;
    this.closing = saved.finally(() => {
      if (accountId !== 0) this.server.releaseAccount(accountId, this.id);
    });

    this.cleanupStep('close callback', () => this.onCloseCb(this));
  }
}

export type FamilyHandler = (
  player: Player,
  action: number,
  reader: EoReader,
) => void | Promise<void>;
