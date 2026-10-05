import { Coords, NpcMapInfo } from 'eolib';
import type { EnfRecord } from 'eolib';

export interface NpcOpponent {
  playerId: number;
  damageDealt: number;
  boredTicks: number;
}

export class NpcInstance {
  readonly index: number;
  readonly id: number;
  readonly data: EnfRecord;
  readonly spawnType: number;
  readonly spawnTime: number;
  readonly spawnCoords: { x: number; y: number };
  readonly fromSpawn: boolean;
  x = 0;
  y = 0;
  direction = 0;
  alive = false;
  spawnTicks: number;
  actTicks = 0;
  talkTicks = 0;
  walkIdleFor = 0;
  hp: number;
  maxHp: number;
  opponents: NpcOpponent[] = [];

  constructor(
    index: number,
    id: number,
    data: EnfRecord,
    spawn: { x: number; y: number; spawnType: number; spawnTime: number },
    instantSpawn: boolean,
    fromSpawn = true,
  ) {
    this.index = index;
    this.id = id;
    this.data = data;
    this.spawnType = spawn.spawnType;
    this.spawnTime = spawn.spawnTime;
    this.spawnCoords = { x: spawn.x, y: spawn.y };
    this.fromSpawn = fromSpawn;
    this.spawnTicks = instantSpawn ? 0 : spawn.spawnTime;
    this.hp = data.hp;
    this.maxHp = data.hp;
  }

  get coords(): Coords {
    const coords = new Coords();
    coords.x = this.x;
    coords.y = this.y;
    return coords;
  }

  get isBoss(): boolean {
    return Boolean(this.data.boss);
  }

  get isChild(): boolean {
    return Boolean(this.data.child);
  }

  hpPercentage(): number {
    return Math.floor((this.hp / Math.max(1, this.maxHp)) * 100);
  }

  toMapInfo(): NpcMapInfo {
    const info = new NpcMapInfo();
    info.index = this.index;
    info.id = this.id;
    info.coords = this.coords;
    info.direction = this.direction;
    return info;
  }

  addOpponentDamage(playerId: number, damage: number): void {
    const existing = this.opponents.find((o) => o.playerId === playerId);
    if (existing !== undefined) {
      existing.damageDealt += damage;
      existing.boredTicks = 0;
    } else {
      this.opponents.push({ playerId, damageDealt: damage, boredTicks: 0 });
    }
  }

  removeOpponent(playerId: number): void {
    this.opponents = this.opponents.filter((o) => o.playerId !== playerId);
  }

  dropOpponents(boredTimer: number, isPresent: (playerId: number) => boolean): void {
    if (this.opponents.length === 0) return;
    this.opponents = this.opponents.filter(
      (o) => o.boredTicks < boredTimer && isPresent(o.playerId),
    );
  }

  die(): void {
    this.alive = false;
    this.hp = 0;
    this.opponents = [];
    this.spawnTicks = this.spawnTime;
  }
}
