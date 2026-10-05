import {
  Coords,
  DialogEntry,
  DialogEntryType,
  EffectAgreeServerPacket,
  EffectPlayerServerPacket,
  Item,
  ItemAcceptServerPacket,
  ItemKickServerPacket,
  MessageOpenServerPacket,
  MusicPlayerServerPacket,
  PlayerEffect,
  RecoverListServerPacket,
  RecoverReplyServerPacket,
  TileEffect,
} from 'eolib';
import {
  defaultQuestProgress,
  type EquipmentSlot,
  type QuestProgress,
} from '../character/character.ts';
import { MAX_KARMA } from '../constants.ts';
import { log } from '../log.ts';
import { closeTrade } from '../player/handlers/trade.ts';
import type { Player } from '../player/player.ts';
import { inClientRange } from '../world/coords.ts';
import { giveExperience } from '../world/map/character/experience.ts';
import { giveItem } from '../world/map/character/items.ts';
import type { GameMap } from '../world/map/game-map.ts';
import { broadcastPartyHp } from '../world/map/party-hp.ts';
import { quakeMap, quakeMaps } from '../world/quake.ts';
import type { QuestAction, QuestCall, QuestRule, QuestState } from './parser.ts';
import type { Quest } from './quest-db.ts';

export const QUEST_FINISHED_STATE = -1;

const MAX_TRANSITIONS_PER_PASS = 100;
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUAKE_STRENGTH = 5;
const WORLD_QUAKE_STRENGTH = 8;

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
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
];

type QuestEvent =
  | { kind: 'gotItem'; itemId: number }
  | { kind: 'lostItem'; itemId: number }
  | { kind: 'equippedItem'; itemId: number }
  | { kind: 'unequippedItem'; itemId: number }
  | { kind: 'killedNpc'; npcId: number }
  | { kind: 'killedPlayer' }
  | { kind: 'enteredMap' }
  | { kind: 'enteredCoord' };

interface QuestPass {
  events: QuestEvent[];
  warp: { mapId: number; x: number; y: number } | null;
  transitions: number;
  exhausted: boolean;
}

export interface QuestReplyResult {
  fired: boolean;
  warped: boolean;
}

const passes = new WeakMap<Player, QuestPass>();
const deferred = new WeakMap<Player, QuestEvent[]>();

function hasArg(call: QuestCall, index: number): boolean {
  return call.args[index] !== undefined;
}

function argInt(call: QuestCall, index: number): number {
  const arg = call.args[index];
  if (typeof arg === 'number') return Math.trunc(arg);
  const parsed = Number.parseInt(String(arg ?? ''), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function argIntOr(call: QuestCall, index: number, fallback: number): number {
  return hasArg(call, index) ? argInt(call, index) : fallback;
}

function argString(call: QuestCall, index: number): string {
  const arg = call.args[index];
  return typeof arg === 'string' ? arg : String(arg ?? '');
}

export function peekProgress(player: Player, questId: number): QuestProgress | undefined {
  return player.character?.quests.get(questId);
}

export function progressOf(player: Player, questId: number): QuestProgress {
  return peekProgress(player, questId) ?? defaultQuestProgress(questId);
}

export function getProgress(player: Player, questId: number): QuestProgress {
  const character = player.character!;
  let progress = character.quests.get(questId);
  if (progress === undefined) {
    progress = defaultQuestProgress(questId);
    character.quests.set(questId, progress);
  }
  return progress;
}

export function currentState(quest: Quest, progress: QuestProgress): QuestState | undefined {
  if (quest.disabled || progress.state < 0) return undefined;
  return quest.stateList[progress.state];
}

function isDialogAction(action: QuestCall, behaviorId: number): boolean {
  return (
    (action.name === 'addnpctext' || action.name === 'addnpcinput') && argInt(action, 0) === behaviorId
  );
}

export function offersDialog(state: QuestState, behaviorId: number): boolean {
  return state.actions.some((action) => isDialogAction(action, behaviorId));
}

export function offersLink(state: QuestState, behaviorId: number, linkId: number): boolean {
  return state.actions.some(
    (action) =>
      action.name === 'addnpcinput' && argInt(action, 0) === behaviorId && argInt(action, 1) === linkId,
  );
}

export function questsForNpc(player: Player, behaviorId: number): Quest[] {
  const result: Quest[] = [];
  for (const quest of player.server.quests.all) {
    const state = currentState(quest, progressOf(player, quest.id));
    if (state !== undefined && offersDialog(state, behaviorId)) result.push(quest);
  }
  return result.sort((a, b) => a.id - b.id);
}

export function dialogEntries(quest: Quest, progress: QuestProgress, behaviorId: number): DialogEntry[] {
  const state = currentState(quest, progress);
  if (state === undefined) return [];
  const entries: DialogEntry[] = [];
  for (const action of state.actions) {
    if (!isDialogAction(action, behaviorId)) continue;
    const entry = new DialogEntry();
    if (action.name === 'addnpctext') {
      if (!hasArg(action, 1)) continue;
      entry.entryType = DialogEntryType.Text;
      entry.line = argString(action, 1);
    } else {
      if (!hasArg(action, 1) || !hasArg(action, 2)) continue;
      entry.entryType = DialogEntryType.Link;
      const link = new DialogEntry.EntryTypeDataLink();
      link.linkId = argInt(action, 1);
      entry.entryTypeData = link;
      entry.line = argString(action, 2);
    }
    entries.push(entry);
  }
  return entries;
}

export function chatMessages(quest: Quest, progress: QuestProgress, behaviorId: number): string[] {
  const state = currentState(quest, progress);
  if (state === undefined) return [];
  return state.actions
    .filter((a) => a.name === 'addnpcchat' && argInt(a, 0) === behaviorId && hasArg(a, 1))
    .map((a) => argString(a, 1));
}

function clearKills(progress: QuestProgress): void {
  progress.npcKills.clear();
  progress.playerKills = 0;
}

function runPass(player: Player, body: (pass: QuestPass) => void): QuestPass {
  const active = passes.get(player);
  if (active !== undefined) {
    body(active);
    return active;
  }
  const pass: QuestPass = { events: [], warp: null, transitions: 0, exhausted: false };
  passes.set(player, pass);
  try {
    body(pass);
    while (pass.events.length > 0 && !pass.exhausted) {
      handleEvent(player, pass, pass.events.shift()!);
    }
  } finally {
    passes.delete(player);
  }
  const character = player.character;
  if (pass.warp !== null && character !== null) {
    const { mapId, x, y } = pass.warp;
    player.requestWarp(mapId, x, y, mapId === character.mapId);
  }
  return pass;
}

function isStateEvent(event: QuestEvent): boolean {
  return (
    event.kind === 'gotItem' ||
    event.kind === 'lostItem' ||
    event.kind === 'enteredMap' ||
    event.kind === 'enteredCoord'
  );
}

function sameEvent(a: QuestEvent, b: QuestEvent): boolean {
  if (a.kind !== b.kind) return false;
  if ('itemId' in a && 'itemId' in b) return a.itemId === b.itemId;
  return true;
}

function enqueue(queue: QuestEvent[], event: QuestEvent): void {
  if (!isStateEvent(event) || !queue.some((queued) => sameEvent(queued, event))) queue.push(event);
}

function dispatch(player: Player, event: QuestEvent): void {
  if (player.character == null) return;
  const active = passes.get(player);
  if (active !== undefined) {
    enqueue(active.events, event);
    return;
  }
  runPass(player, (pass) => handleEvent(player, pass, event));
}

function defer(player: Player, event: QuestEvent): void {
  if (player.character == null) return;
  const active = passes.get(player);
  if (active !== undefined) {
    enqueue(active.events, event);
    return;
  }
  let queue = deferred.get(player);
  if (queue === undefined) {
    queue = [];
    deferred.set(player, queue);
    queueMicrotask(() => flushQuestEvents(player));
  }
  enqueue(queue, event);
}

export function flushQuestEvents(player: Player): void {
  const queue = deferred.get(player);
  if (queue === undefined) return;
  deferred.delete(player);
  if (player.character == null || queue.length === 0) return;
  try {
    runPass(player, (pass) => {
      for (const event of queue) enqueue(pass.events, event);
    });
  } catch (err) {
    log.error(
      { cat: 'quest', player: player.id, err: err instanceof Error ? err.stack : String(err) },
      'deferred quest events failed',
    );
  }
}

function amountArg(rule: QuestCall): number {
  return argIntOr(rule, 1, 1);
}

function matchEventRule(
  player: Player,
  progress: QuestProgress,
  state: QuestState,
  event: QuestEvent,
): QuestRule | undefined {
  const character = player.character!;
  switch (event.kind) {
    case 'gotItem': {
      const rule = state.rules.find((r) => r.name === 'gotitems' && argInt(r, 0) === event.itemId);
      return rule !== undefined && character.heldAmount(event.itemId) >= amountArg(rule) ? rule : undefined;
    }
    case 'lostItem': {
      const rule = state.rules.find((r) => r.name === 'lostitems' && argInt(r, 0) === event.itemId);
      return rule !== undefined && character.heldAmount(event.itemId) < amountArg(rule) ? rule : undefined;
    }
    case 'equippedItem':
      return state.rules.find((r) => r.name === 'equippeditem' && argInt(r, 0) === event.itemId);
    case 'unequippedItem':
      return state.rules.find((r) => r.name === 'unequippeditem' && argInt(r, 0) === event.itemId);
    case 'killedNpc': {
      const rule = state.rules.find((r) => r.name === 'killednpcs' && argInt(r, 0) === event.npcId);
      if (rule === undefined) return undefined;
      const kills = (progress.npcKills.get(event.npcId) ?? 0) + 1;
      progress.npcKills.set(event.npcId, kills);
      return kills >= amountArg(rule) ? rule : undefined;
    }
    case 'killedPlayer': {
      const rule = state.rules.find((r) => r.name === 'killedplayers');
      if (rule === undefined) return undefined;
      progress.playerKills++;
      return progress.playerKills >= argIntOr(rule, 0, 1) ? rule : undefined;
    }
    case 'enteredMap': {
      const mapId = character.mapId;
      return state.rules.find(
        (r) =>
          (r.name === 'entermap' && argInt(r, 0) === mapId) ||
          (r.name === 'leavemap' && argInt(r, 0) !== mapId),
      );
    }
    case 'enteredCoord': {
      const { x, y } = character.row;
      const mapId = character.mapId;
      return state.rules.find(
        (r) =>
          r.name === 'entercoord' &&
          argInt(r, 0) === mapId &&
          argInt(r, 1) === x &&
          argInt(r, 2) === y,
      );
    }
  }
}

function handleEvent(player: Player, pass: QuestPass, event: QuestEvent): void {
  const character = player.character;
  if (character == null) return;
  const fired: { quest: Quest; rule: QuestRule }[] = [];
  for (const progress of [...character.quests.values()]) {
    const quest = player.server.quests.get(progress.questId);
    if (quest === undefined) continue;
    const state = currentState(quest, progress);
    if (state === undefined) continue;
    const rule = matchEventRule(player, progress, state, event);
    if (rule !== undefined) fired.push({ quest, rule });
  }
  for (const { quest, rule } of fired) {
    if (pass.exhausted) return;
    fireRule(player, pass, quest, rule);
  }
}

function spend(player: Player, pass: QuestPass, quest: Quest, target: string): boolean {
  if (pass.exhausted) return false;
  pass.transitions++;
  if (pass.transitions <= MAX_TRANSITIONS_PER_PASS) return true;
  log.warn(
    { quest: quest.id, state: target, character: player.character?.name },
    'quest state chain exceeded the transition limit; stopping',
  );
  pass.exhausted = true;
  return false;
}

function fireRule(player: Player, pass: QuestPass, quest: Quest, rule: QuestRule): void {
  if (rule.gotoState !== null) {
    transition(player, pass, quest, rule.gotoState);
    return;
  }
  if (rule.action === null) return;
  const progress = peekProgress(player, quest.id);
  if (progress === undefined) return;
  if (!spend(player, pass, quest, rule.action.name)) return;
  const outcome = runActions(player, pass, quest, progress, [rule.action]);
  if (outcome.next !== null) transition(player, pass, quest, outcome.next);
}

function transition(player: Player, pass: QuestPass, quest: Quest, target: string): void {
  const progress = peekProgress(player, quest.id);
  if (progress === undefined) return;
  if (!spend(player, pass, quest, target)) return;

  const stateName = target.toLowerCase();
  const index = quest.stateList.findIndex((s) => s.name.toLowerCase() === stateName);
  if (index === -1) {
    if (stateName === 'end' || stateName === 'done') {
      progress.doneAt = new Date();
      progress.state = QUEST_FINISHED_STATE;
      clearKills(progress);
      return;
    }
    log.warn({ quest: quest.id, state: target }, 'quest goto targets a missing state; state unchanged');
    return;
  }

  progress.state = index;
  clearKills(progress);
  enterState(player, pass, quest);
}

function resetQuest(player: Player, progress: QuestProgress): boolean {
  if (progress.doneAt === null) {
    player.character!.quests.delete(progress.questId);
    return true;
  }
  progress.state = 0;
  clearKills(progress);
  return false;
}

function enterState(player: Player, pass: QuestPass, quest: Quest): void {
  const character = player.character!;
  const progress = peekProgress(player, quest.id);
  if (progress === undefined) return;
  const state = currentState(quest, progress);
  if (state === undefined) return;

  const outcome = runActions(player, pass, quest, progress, state.actions);
  if (outcome.next !== null) {
    transition(player, pass, quest, outcome.next);
    return;
  }
  if (outcome.reset || pass.exhausted) return;

  const always = state.rules.find((rule) => rule.name === 'always');
  if (always !== undefined) {
    fireRule(player, pass, quest, always);
    return;
  }
  for (const rule of state.rules) {
    if (rule.name !== 'gotitems') continue;
    const itemId = argInt(rule, 0);
    if (character.heldAmount(itemId) > 0 && character.heldAmount(itemId) >= amountArg(rule)) {
      fireRule(player, pass, quest, rule);
      return;
    }
  }
}

interface ActionOutcome {
  reset: boolean;
  next: string | null;
}

function runActions(
  player: Player,
  pass: QuestPass,
  quest: Quest,
  progress: QuestProgress,
  actions: QuestAction[],
): ActionOutcome {
  const character = player.character!;
  const outcome: ActionOutcome = { reset: false, next: null };
  let removed = false;
  let lastCondition = false;

  for (const action of actions) {
    if ((action.branch === 'elseif' || action.branch === 'else') && lastCondition) continue;
    if (action.branch === 'if' || action.branch === 'elseif') {
      lastCondition = action.condition !== undefined && checkCondition(player, progress, action.condition);
      if (!lastCondition) continue;
    }

    switch (action.name) {
      case 'addnpctext':
      case 'addnpcinput':
      case 'addnpcchat':
        break;
      case 'end':
        if (!removed) progress.doneAt = new Date();
        break;
      case 'reset':
        if (!removed) {
          removed = resetQuest(player, progress);
          outcome.reset = true;
          outcome.next = null;
        }
        break;
      case 'resetdaily':
        if (!removed) {
          if (progress.doneAt === null) progress.doneAt = new Date();
          progress.completions++;
          progress.state = 0;
          clearKills(progress);
          outcome.reset = true;
          outcome.next = null;
        }
        break;
      case 'setstate':
        if (!removed && character.quests.has(quest.id)) outcome.next = argString(action, 0);
        break;
      default:
        runEffect(player, pass, quest, action);
    }
  }
  return outcome;
}

function checkCondition(player: Player, progress: QuestProgress, condition: QuestCall): boolean {
  const character = player.character!;
  switch (condition.name) {
    case 'always':
      return true;
    case 'gotitems':
      return character.heldAmount(argInt(condition, 0)) >= amountArg(condition);
    case 'lostitems':
      return character.heldAmount(argInt(condition, 0)) < amountArg(condition);
    case 'entermap':
      return character.mapId === argInt(condition, 0);
    case 'leavemap':
      return character.mapId !== argInt(condition, 0);
    case 'entercoord':
    case 'leavecoord': {
      const at =
        character.mapId === argInt(condition, 0) &&
        character.row.x === argInt(condition, 1) &&
        character.row.y === argInt(condition, 2);
      return condition.name === 'entercoord' ? at : !at;
    }
    case 'isgender':
      return character.row.gender === argInt(condition, 0);
    case 'isclass':
      return character.row.class === argInt(condition, 0);
    case 'israce':
      return character.row.race === argInt(condition, 0);
    case 'iswearing': {
      const itemId = argInt(condition, 0);
      return EQUIPMENT_SLOTS.some((slot) => character.equipment(slot) === itemId);
    }
    case 'citizenof':
      return (character.row.home ?? '').toLowerCase() === argString(condition, 0).toLowerCase();
    case 'gotspell': {
      const spell = character.spells.find((s) => s.id === argInt(condition, 0));
      return spell !== undefined && (!hasArg(condition, 1) || spell.level >= argInt(condition, 1));
    }
    case 'lostspell':
      return !character.spells.some((s) => s.id === argInt(condition, 0));
    case 'donedaily':
      return (
        progress.doneAt !== null &&
        Date.now() - progress.doneAt.getTime() < DAILY_WINDOW_MS &&
        progress.completions >= argInt(condition, 0)
      );
    default:
      log.debug({ condition: condition.name }, 'unsupported quest condition');
      return false;
  }
}

function observersOf(map: GameMap, x: number, y: number): Player[] {
  const observers: Player[] = [];
  for (const [playerId, other] of map.players) {
    const observer = map.characters.get(playerId);
    if (observer !== undefined && inClientRange(observer.row.x, observer.row.y, x, y)) observers.push(other);
  }
  return observers;
}

function quakeWorld(player: Player, strength: number): void {
  quakeMaps(player.server.world.all, strength);
}

function sendRecoverReply(player: Player): void {
  const character = player.character!;
  const packet = new RecoverReplyServerPacket();
  packet.experience = character.row.experience;
  packet.karma = character.row.karma;
  player.bus.send(packet);
}

function runEffect(player: Player, pass: QuestPass, quest: Quest, action: QuestAction): void {
  const character = player.character!;
  const map = player.map;
  switch (action.name) {
    case 'showhint': {
      const packet = new MessageOpenServerPacket();
      packet.message = argString(action, 0);
      player.bus.send(packet);
      return;
    }
    case 'playsound':
    case 'playmusic': {
      if (!hasArg(action, 0)) return;
      const packet = new MusicPlayerServerPacket();
      packet.soundId = argInt(action, 0);
      player.bus.send(packet);
      return;
    }
    case 'setmap':
    case 'setcoord': {
      if (!hasArg(action, 0) || !hasArg(action, 1) || !hasArg(action, 2)) return;
      pass.warp = { mapId: argInt(action, 0), x: argInt(action, 1), y: argInt(action, 2) };
      return;
    }
    case 'giveexp': {
      if (map === null || !hasArg(action, 0)) return;
      const amount = Math.trunc(argInt(action, 0) * player.config.world.expMultiplier);
      if (amount === 0) return;
      const leveled = giveExperience(map, character, amount);
      const packet = new RecoverReplyServerPacket();
      packet.experience = character.row.experience;
      packet.karma = character.row.karma;
      if (leveled) {
        packet.levelUp = character.row.level;
        packet.statPoints = character.row.stat_points;
        packet.skillPoints = character.row.skill_points;
      }
      player.bus.send(packet);
      if (leveled && character.row.hidden !== 1) {
        const accept = new ItemAcceptServerPacket();
        accept.playerId = character.playerId;
        map.broadcastNear(accept, character.row.x, character.row.y, character.playerId);
      }
      return;
    }
    case 'giveitem': {
      if (map === null) return;
      const itemId = argInt(action, 0);
      const amount = character.canHoldAmount(itemId, argIntOr(action, 1, 1), player.config.limits.maxItem);
      if (itemId < 1 || amount <= 0) return;
      giveItem(map, player, character, itemId, amount);
      dispatch(player, { kind: 'gotItem', itemId });
      return;
    }
    case 'removeitem': {
      const itemId = argInt(action, 0);
      const amount = argIntOr(action, 1, 1);
      if (itemId < 1 || amount <= 0 || amount > player.config.limits.maxItem) return;
      if (character.heldAmount(itemId) === 0) return;
      if (player.trade !== null) closeTrade(player);
      character.removeItem(itemId, Math.min(amount, character.heldAmount(itemId)));
      const packet = new ItemKickServerPacket();
      const item = new Item();
      item.id = itemId;
      item.amount = character.heldAmount(itemId);
      packet.item = item;
      packet.currentWeight = character.weight(player.server.pubData).current;
      player.bus.send(packet);
      dispatch(player, { kind: 'lostItem', itemId });
      return;
    }
    case 'setclass': {
      if (!hasArg(action, 0)) return;
      const classId = argInt(action, 0);
      if (classId < 0) return;
      character.row.class = classId;
      const hp = character.row.hp;
      const maxHp = character.maxHp;
      character.calculateStats(player.server.formulas, player.server.pubData, player.config.combat);
      if (map !== null && (character.row.hp !== hp || character.maxHp !== maxHp)) {
        broadcastPartyHp(map, character);
      }
      const packet = new RecoverListServerPacket();
      packet.classId = classId;
      packet.stats = character.statsUpdate(player.server.pubData);
      player.bus.send(packet);
      return;
    }
    case 'givekarma': {
      if (!hasArg(action, 0)) return;
      const gained = Math.max(0, Math.min(MAX_KARMA - character.row.karma, argInt(action, 0)));
      character.row.karma += gained;
      sendRecoverReply(player);
      return;
    }
    case 'removekarma': {
      if (!hasArg(action, 0)) return;
      const lost = Math.min(character.row.karma, argInt(action, 0));
      if (lost <= 0) return;
      character.row.karma -= lost;
      sendRecoverReply(player);
      return;
    }
    case 'quake': {
      const strength = argIntOr(action, 0, DEFAULT_QUAKE_STRENGTH);
      if (strength === WORLD_QUAKE_STRENGTH) quakeWorld(player, strength);
      else if (player.map !== null) quakeMap(player.map, strength);
      return;
    }
    case 'quakeworld':
      quakeWorld(player, argIntOr(action, 0, DEFAULT_QUAKE_STRENGTH));
      return;
    case 'effectonplayer': {
      if (map === null || !hasArg(action, 0) || character.row.hidden === 1) return;
      const packet = new EffectPlayerServerPacket();
      const effect = new PlayerEffect();
      effect.playerId = character.playerId;
      effect.effectId = argInt(action, 0);
      packet.effects = [effect];
      map.sendToAll(packet, observersOf(map, character.row.x, character.row.y));
      return;
    }
    case 'effectoncoord': {
      if (map === null || !hasArg(action, 0) || !hasArg(action, 1) || !hasArg(action, 2)) return;
      const coords = new Coords();
      coords.x = argInt(action, 1);
      coords.y = argInt(action, 2);
      const packet = new EffectAgreeServerPacket();
      const effect = new TileEffect();
      effect.coords = coords;
      effect.effectId = argInt(action, 0);
      packet.effects = [effect];
      map.sendToAll(packet, observersOf(map, coords.x, coords.y));
      return;
    }
    default:
      log.debug({ quest: quest.id, action: action.name }, 'unhandled quest action');
  }
}

function doneDailyReached(progress: QuestProgress, rule: QuestRule, now: number): boolean {
  if (!hasArg(rule, 0) || progress.doneAt === null) return false;
  if (now - progress.doneAt.getTime() < DAILY_WINDOW_MS) {
    return progress.completions >= argInt(rule, 0);
  }
  progress.completions = 0;
  progress.doneAt = null;
  return false;
}

export function talkedToNpc(
  player: Player,
  quest: Quest,
  behaviorId: number,
  actionId: number | null,
): QuestReplyResult {
  const none: QuestReplyResult = { fired: false, warped: false };
  if (player.character == null) return none;
  const progress = peekProgress(player, quest.id);
  if (progress === undefined) return none;
  const state = currentState(quest, progress);
  if (state === undefined || !offersDialog(state, behaviorId)) return none;
  if (actionId !== null && !offersLink(state, behaviorId, actionId)) return none;

  const now = Date.now();
  const rule = state.rules.find((candidate) => {
    if (actionId === null) {
      return candidate.name === 'talkedtonpc' && argInt(candidate, 0) === behaviorId;
    }
    if (candidate.name === 'donedaily') return doneDailyReached(progress, candidate, now);
    return candidate.name === 'inputnpc' && argInt(candidate, 0) === actionId;
  });
  if (rule === undefined) return none;

  const pass = runPass(player, (active) => fireRule(player, active, quest, rule));
  return { fired: true, warped: pass.warp !== null };
}

export function advance(player: Player, quest: Quest, stateName: string): void {
  if (player.character == null) return;
  getProgress(player, quest.id);
  runPass(player, (pass) => transition(player, pass, quest, stateName));
}

export function killedNpc(player: Player, npcId: number): void {
  dispatch(player, { kind: 'killedNpc', npcId });
}

export function killedPlayer(player: Player): void {
  dispatch(player, { kind: 'killedPlayer' });
}

export function deferEnteredMap(player: Player): void {
  defer(player, { kind: 'enteredMap' });
}

export function deferGotItem(player: Player, itemId: number): void {
  defer(player, { kind: 'gotItem', itemId });
}

export function deferLostItem(player: Player, itemId: number): void {
  defer(player, { kind: 'lostItem', itemId });
}

export function enteredCoord(player: Player): void {
  dispatch(player, { kind: 'enteredCoord' });
}

export function gotItem(player: Player, itemId: number): void {
  dispatch(player, { kind: 'gotItem', itemId });
}

export function equippedItem(player: Player, itemId: number): void {
  dispatch(player, { kind: 'equippedItem', itemId });
}

export function unequippedItem(player: Player, itemId: number): void {
  dispatch(player, { kind: 'unequippedItem', itemId });
}
