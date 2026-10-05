import {
  AvatarRemoveServerPacket,
  Emf,
  EoReader,
  EoWriter,
  InitInitServerPacket,
  InitReply,
  MapFile,
  NearbyInfo,
  PlayersAgreeServerPacket,
  WarpEffect,
} from 'eolib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Character } from '../../character/character.ts';
import type { Config } from '../../config.ts';
import type { ArenaTable } from '../../data/arenas.ts';
import type { DropTables } from '../../data/drops.ts';
import type { Formulas } from '../../data/formulas.ts';
import type { PubData } from '../../data/pub-data.ts';
import { log } from '../../log.ts';
import type { OutgoingPacket } from '../../net/packet-bus.ts';
import type { Player } from '../../player/player.ts';
import { deferEnteredMap, deferGotItem, deferLostItem } from '../../quest/engine.ts';
import { inClientRange, inRange } from '../coords.ts';
import type { PartyManager } from '../party.ts';
import { timedAutoPickup } from './auto-pickup.ts';
import { requestRefresh, sendBossPings } from './character/refresh.ts';
import { timedEvacuate } from './evacuate.ts';
import { arenaLeave, timedArena, type ArenaPlayer } from './events/arena.ts';
import { timedDrain, timedQuake, timedSpikes } from './events/hazards.ts';
import {
  recoverNpcs,
  recoverPlayers,
  timedDoorClose,
  timedDropProtection,
  timedGhost,
  timedWarpSuck,
} from './events/timers.ts';
import { initChests, spawnChestItems } from './interact/chest.ts';
import { jukeboxTimer } from './interact/jukebox.ts';
import { timedWedding, type Wedding } from './interact/wedding.ts';
import { removeItem, timedCleanup } from './items.ts';
import { mapFilePath } from './map-files.ts';
import { actNpcs } from './npc/act.ts';
import type { NpcInstance } from './npc/npc.ts';
import { spawnNpcs } from './npc/spawn.ts';
import { buildTileIndex, isInBounds, type TileIndex } from './tiles.ts';

export interface GameMapDeps {
  config: Config;
  pubData: PubData;
  formulas: Formulas;
  drops: DropTables;
  arenas?: ArenaTable;
  parties?: PartyManager;
  getPlayer?(playerId: number): Player | undefined;
  getMap?(mapId: number): GameMap | undefined;
}

interface PacketSink {
  send(packet: OutgoingPacket): void;
  sendRaw?(action: number, family: number, data: Uint8Array): void;
}

export interface MapItem {
  index: number;
  id: number;
  amount: number;
  x: number;
  y: number;
  owner: number;
  protectedTicks: number;
}

export interface Door {
  x: number;
  y: number;
  key: number;
  open: boolean;
  openTicks: number;
}

export interface ChestItem {
  id: number;
  amount: number;
  slot: number;
}

export interface ChestSpawn {
  itemId: number;
  amount: number;
  spawnTime: number;
  slot: number;
  takenAt: number;
}

export interface ChestState {
  x: number;
  y: number;
  key: number;
  items: ChestItem[];
  spawns: ChestSpawn[];
}

export interface MapTickEvents {
  second: boolean;
  npcAct: boolean;
  recover: boolean;
  npcRecover: boolean;
  chestSpawn: boolean;
  spike: boolean;
  drain: boolean;
  quake: boolean;
  autoPickup?: boolean;
}

export class GameMap {
  readonly id: number;
  readonly deps: GameMapDeps;
  emf: Emf;
  fileBytes: Uint8Array;
  tiles: TileIndex;
  readonly characters = new Map<number, Character>();
  readonly players = new Map<number, Player>();
  readonly npcs = new Map<number, NpcInstance>();
  readonly items = new Map<number, MapItem>();
  readonly doors = new Map<string, Door>();
  readonly chests = new Map<string, ChestState>();
  readonly ghostTicks = new Map<number, number>();
  itemIndexCounter = 0;
  npcsInitialized = false;
  quakeTicks = 0;
  quakeRate: number | null = null;
  quakeStrength: number | null = null;
  jukeboxPlayerName: string | null = null;
  jukeboxTicks = 0;
  wedding: Wedding | null = null;
  evacuateTicks: number | null = null;
  arenaPlayers: ArenaPlayer[] = [];
  arenaTicks = 0;

  constructor(id: number, fileBytes: Uint8Array, deps: GameMapDeps) {
    this.id = id;
    this.fileBytes = fileBytes;
    this.emf = Emf.deserialize(new EoReader(fileBytes));
    this.deps = deps;
    this.tiles = buildTileIndex(this.emf);
    this.indexDoors();
    initChests(this);
  }

  indexTiles(): void {
    this.tiles = buildTileIndex(this.emf);
    this.indexDoors();
  }

  private indexDoors(): void {
    this.doors.clear();
    for (const row of this.emf.warpRows) {
      for (const tile of row.tiles) {
        if (tile.warp.door > 0) {
          this.doors.set(`${tile.x},${row.y}`, {
            x: tile.x,
            y: row.y,
            key: tile.warp.door,
            open: false,
            openTicks: 0,
          });
        }
      }
    }
  }

  reloadFromDisk(dataDir: string): boolean {
    const file = mapFilePath(join(dataDir, 'maps'), this.id);
    let bytes: Uint8Array;
    let emf: Emf;
    try {
      bytes = Uint8Array.from(readFileSync(file));
      emf = Emf.deserialize(new EoReader(bytes));
    } catch (err) {
      log.warn({ map: this.id, err: String(err) }, 'remap failed to read map file');
      return false;
    }
    this.reload(bytes, emf);
    return true;
  }

  reload(bytes: Uint8Array, emf: Emf): void {
    this.fileBytes = bytes;
    this.emf = emf;
    this.indexTiles();
    this.npcs.clear();
    this.npcsInitialized = false;
    this.chests.clear();
    initChests(this);
    this.quakeTicks = 0;
    this.quakeRate = null;
    this.quakeStrength = null;
    this.jukeboxPlayerName = null;
    this.jukeboxTicks = 0;
    this.wedding = null;
    this.evacuateTicks = null;
    this.arenaPlayers = [];
    this.arenaTicks = 0;
    for (const item of [...this.items.values()]) {
      if (!isInBounds(this, item.x, item.y)) removeItem(this, item.index);
    }

    const mutation = new InitInitServerPacket();
    mutation.replyCode = InitReply.MapMutation;
    const data = new InitInitServerPacket.ReplyCodeDataMapMutation();
    const mapFile = new MapFile();
    mapFile.content = bytes;
    data.mapFile = mapFile;
    mutation.replyCodeData = data;
    for (const [playerId, player] of this.players) {
      player.bus.send(mutation);
      const character = this.characters.get(playerId);
      if (character !== undefined) requestRefresh(this, player, character);
    }
  }

  get rid(): number[] {
    return this.emf.rid;
  }

  get fileSize(): number {
    return this.fileBytes.length;
  }

  broadcast(packet: OutgoingPacket, excludePlayerId?: number): void {
    const recipients: Player[] = [];
    for (const [playerId, player] of this.players) {
      if (playerId !== excludePlayerId) recipients.push(player);
    }
    this.sendToAll(packet, recipients);
  }

  broadcastNear(packet: OutgoingPacket, x: number, y: number, excludePlayerId?: number): void {
    const recipients: Player[] = [];
    for (const [playerId, player] of this.players) {
      if (playerId === excludePlayerId) continue;
      const character = this.characters.get(playerId);
      if (character !== undefined && inRange(character.row.x, character.row.y, x, y)) {
        recipients.push(player);
      }
    }
    this.sendToAll(packet, recipients);
  }

  sendToAll(packet: OutgoingPacket, recipients: readonly Player[]): void {
    if (recipients.length === 0) return;
    let data: Uint8Array;
    try {
      const writer = new EoWriter();
      packet.serialize(writer);
      data = writer.toByteArray();
    } catch (err) {
      log.error(
        { cat: 'map', map: this.id, family: packet.family, action: packet.action, err: String(err) },
        'broadcast packet failed to serialize; dropped',
      );
      return;
    }
    let failed = false;
    for (const player of recipients) {
      const bus: PacketSink = player.bus;
      try {
        if (bus.sendRaw !== undefined) bus.sendRaw(packet.action, packet.family, data);
        else bus.send(packet);
      } catch (err) {
        if (failed) continue;
        failed = true;
        log.error(
          { cat: 'map', map: this.id, family: packet.family, action: packet.action, err: String(err) },
          'broadcast packet failed to send',
        );
      }
    }
  }

  broadcastNearPlayer(packet: OutgoingPacket, playerId: number): void {
    const character = this.characters.get(playerId);
    if (character === undefined) return;
    this.broadcastNear(packet, character.row.x, character.row.y, playerId);
  }

  getPlayer(playerId: number): Player | undefined {
    return this.players.get(playerId);
  }

  enter(character: Character, player: Player, warpEffect?: number): void {
    if (character.row.hidden !== 1) {
      const announce = new PlayersAgreeServerPacket();
      const nearby = new NearbyInfo();
      const info = character.toMapInfo(this.deps.pubData);
      if (warpEffect !== undefined && warpEffect !== WarpEffect.None) info.warpEffect = warpEffect;
      nearby.characters = [info];
      nearby.npcs = [];
      nearby.items = [];
      announce.nearby = nearby;
      this.broadcastNear(announce, character.row.x, character.row.y);
    }

    this.characters.set(character.playerId, character);
    this.players.set(character.playerId, player);
    this.ghostTicks.set(character.playerId, this.deps.config.world.ghostRate);
    character.itemListener = {
      gotItem: (itemId) => deferGotItem(player, itemId),
      lostItem: (itemId) => deferLostItem(player, itemId),
    };
    sendBossPings(
      player,
      [...this.npcs.values()].filter((npc) =>
        inClientRange(character.row.x, character.row.y, npc.x, npc.y),
      ),
    );
    deferEnteredMap(player);
  }

  refreshCharacter(player: Player): void {
    const character = player.character;
    if (character === null) return;
    const remove = new AvatarRemoveServerPacket();
    remove.playerId = character.playerId;
    const agree = new PlayersAgreeServerPacket();
    const nearby = new NearbyInfo();
    nearby.characters = [character.toMapInfo(this.deps.pubData)];
    nearby.npcs = [];
    nearby.items = [];
    agree.nearby = nearby;
    if (character.row.hidden === 1) {
      player.bus.send(remove);
      player.bus.send(agree);
      return;
    }
    this.broadcastNear(remove, character.row.x, character.row.y);
    this.broadcastNear(agree, character.row.x, character.row.y);
  }

  leave(playerId: number, warpEffect?: number): void {
    const character = this.characters.get(playerId);
    this.characters.delete(playerId);
    this.players.delete(playerId);
    this.ghostTicks.delete(playerId);
    arenaLeave(this, playerId, character);
    if (character === undefined || character.row.hidden === 1) return;

    const remove = new AvatarRemoveServerPacket();
    remove.playerId = playerId;
    if (warpEffect !== undefined && warpEffect !== WarpEffect.None) remove.warpEffect = warpEffect;
    this.broadcastNear(remove, character.row.x, character.row.y);
  }

  private runEvent(name: string, event: (map: GameMap) => void): void {
    try {
      event(this);
    } catch (err) {
      log.error(
        { cat: 'map', map: this.id, event: name, err: err instanceof Error ? err.stack : String(err) },
        'map event failed',
      );
    }
  }

  tick(events: MapTickEvents): void {
    if (events.npcAct) this.runEvent('actNpcs', actNpcs);
    if (events.autoPickup === true) this.runEvent('timedAutoPickup', timedAutoPickup);
    if (events.second) {
      this.runEvent('spawnNpcs', spawnNpcs);
      this.runEvent('timedWarpSuck', timedWarpSuck);
      this.runEvent('timedDoorClose', timedDoorClose);
      this.runEvent('timedWedding', timedWedding);
      this.runEvent('timedEvacuate', timedEvacuate);
      this.runEvent('jukeboxTimer', jukeboxTimer);
      this.runEvent('timedDropProtection', timedDropProtection);
      this.runEvent('timedGhost', timedGhost);
      this.runEvent('timedCleanup', timedCleanup);
      this.runEvent('timedArena', timedArena);
    }
    if (events.chestSpawn) this.runEvent('spawnChestItems', spawnChestItems);
    if (events.recover) this.runEvent('recoverPlayers', recoverPlayers);
    if (events.npcRecover) this.runEvent('recoverNpcs', recoverNpcs);
    if (events.quake) this.runEvent('timedQuake', timedQuake);
    if (events.spike) this.runEvent('timedSpikes', timedSpikes);
    if (events.drain) this.runEvent('timedDrain', timedDrain);
  }
}
