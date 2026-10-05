import {
  EoReader,
  InitInitServerPacket,
  InitReply,
  MapFile,
  PacketAction,
  SitState,
  WarpAcceptClientPacket,
  WarpAgreeServerPacket,
  WarpTakeClientPacket,
  WarpType,
} from 'eolib';
import { log } from '../../log.ts';
import { snapshotMaps, writeMapSnapshots } from '../../save-coordinator.ts';
import { getNearbyInfo } from '../../world/map/visibility.ts';
import { ClientState } from '../client-state.ts';
import type { Player } from '../player.ts';
import { cancelTrade } from './trade.ts';

async function warpAccept(player: Player, reader: EoReader): Promise<void> {
  const accept = WarpAcceptClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame) return;

  const session = player.warpSession;
  if (session === null) return;
  if (session.sessionId !== accept.sessionId) {
    log.warn(
      { cat: 'warp', player: player.id, got: accept.sessionId, expected: session.sessionId },
      'ignoring warp accept with a stale session',
    );
    return;
  }
  player.warpSession = null;

  const character = player.character;
  if (character === null) return;

  let target = player.server.world.getMap(session.mapId);
  if (target === undefined) {
    const { rescueMap, rescueX, rescueY } = player.config.world;
    target = player.server.world.getMap(rescueMap);
    if (target === undefined) {
      player.close(`warp target ${session.mapId} and rescue map missing`);
      return;
    }
    session.mapId = rescueMap;
    session.x = rescueX;
    session.y = rescueY;
  }

  cancelTrade(player, true);
  player.clearInteractions();
  const source = player.map;
  source?.leave(character.playerId, session.effect);
  character.mapId = session.mapId;
  character.setCoords(session.x, session.y);
  character.row.sitting = SitState.Stand;

  player.map = target;
  target.enter(character, player, session.effect);
  log.info(
    { cat: 'warp', character: character.name, map: session.mapId, x: session.x, y: session.y },
    'player warped',
  );

  const agree = new WarpAgreeServerPacket();
  agree.nearby = getNearbyInfo(target, character.row.x, character.row.y, character.playerId);
  if (session.local) {
    agree.warpType = WarpType.Local;
  } else {
    agree.warpType = WarpType.MapSwitch;
    const data = new WarpAgreeServerPacket.WarpTypeDataMapSwitch();
    data.mapId = session.mapId;
    data.warpEffect = session.effect;
    agree.warpTypeData = data;
  }
  player.bus.send(agree);
  player.respawn();

  const { mapSaves } = player.config;
  const snapshots = source === null ? [] : snapshotMaps([source], mapSaves);
  const persist = async (): Promise<void> => {
    await character.save(player.server.db);
    await writeMapSnapshots(snapshots, mapSaves.dir);
  };
  const saves = player.server.saves;
  await (saves === undefined ? persist() : saves.run(persist));
}

function warpTake(player: Player, reader: EoReader): void {
  const take = WarpTakeClientPacket.deserialize(reader);
  if (player.state !== ClientState.InGame) return;

  const session = player.warpSession;
  if (session === null || session.sessionId !== take.sessionId) {
    log.warn(
      { cat: 'warp', player: player.id, got: take.sessionId, expected: session?.sessionId ?? null },
      'ignoring warp take with a stale session',
    );
    return;
  }

  const map = player.server.world.getMap(session.mapId);
  if (map === undefined) {
    player.close('warp take with no valid warp session');
    return;
  }

  const reply = new InitInitServerPacket();
  reply.replyCode = InitReply.WarpMap;
  const data = new InitInitServerPacket.ReplyCodeDataWarpMap();
  const file = new MapFile();
  file.content = map.fileBytes;
  data.mapFile = file;
  reply.replyCodeData = data;
  player.bus.send(reply);
}

export function handleWarp(player: Player, action: number, reader: EoReader): Promise<void> | void {
  switch (action) {
    case PacketAction.Accept:
      return warpAccept(player, reader);
    case PacketAction.Take:
      return warpTake(player, reader);
    default:
      log.debug({ player: player.id, action }, 'unhandled Warp action');
  }
}
