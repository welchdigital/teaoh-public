import { Coords, DoorOpenServerPacket, ItemType } from 'eolib';
import type { Character } from '../../../character/character.ts';
import { inClientRange } from '../../coords.ts';
import type { GameMap } from '../game-map.ts';

export function openDoor(map: GameMap, character: Character, x: number, y: number): void {
  const door = map.doors.get(`${x},${y}`);
  if (door === undefined || door.open) return;
  if (!inClientRange(character.row.x, character.row.y, x, y)) return;

  if (door.key > 1) {
    const hasKey = character.items.some((item) => {
      const record = map.deps.pubData.eif?.parsed.items[item.id - 1];
      return record !== undefined && record.type === ItemType.Key && record.spec1 === door.key;
    });
    if (!hasKey) return;
  }

  door.open = true;
  door.openTicks = 0;
  const packet = new DoorOpenServerPacket();
  const coords = new Coords();
  coords.x = x;
  coords.y = y;
  packet.coords = coords;
  map.broadcastNear(packet, x, y);
}
