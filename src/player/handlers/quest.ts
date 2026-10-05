import {
  DialogQuestEntry,
  EoReader,
  NpcType,
  PacketAction,
  QuestAcceptClientPacket,
  QuestDialogServerPacket,
  QuestListClientPacket,
  QuestListServerPacket,
  QuestPage,
  QuestProgressEntry,
  QuestReportServerPacket,
  QuestRequirementIcon,
  QuestUseClientPacket,
  SHORT_MAX,
} from 'eolib';
import type { QuestProgress } from '../../character/character.ts';
import {
  chatMessages,
  currentState,
  dialogEntries,
  getProgress,
  offersDialog,
  offersLink,
  peekProgress,
  progressOf,
  questsForNpc,
  talkedToNpc,
} from '../../quest/engine.ts';
import type { QuestCall, QuestState } from '../../quest/parser.ts';
import type { Quest } from '../../quest/quest-db.ts';
import { inClientRange } from '../../world/coords.ts';
import type { NpcInstance } from '../../world/map/npc/npc.ts';
import { log } from '../../log.ts';
import type { Player } from '../player.ts';
import { inGame } from './common.ts';

function questNpc(player: Player, npcIndex: number): NpcInstance | null {
  const npc = player.map!.npcs.get(npcIndex);
  if (npc === undefined || !npc.alive || npc.data.type !== NpcType.Quest) return null;
  const character = player.character!;
  if (!inClientRange(character.row.x, character.row.y, npc.x, npc.y)) return null;
  return npc;
}

function selectQuest(
  player: Player,
  behaviorId: number,
  questId: number,
): { quests: Quest[]; selected: Quest } | null {
  const quests = questsForNpc(player, behaviorId);
  const selected = questId > 0 ? quests.find((q) => q.id === questId) : quests[0];
  return selected === undefined ? null : { quests, selected };
}

function sendDialog(
  player: Player,
  behaviorId: number,
  quests: Quest[],
  selected: Quest,
  sessionId: number,
): void {
  const dialog = new QuestDialogServerPacket();
  dialog.behaviorId = behaviorId;
  dialog.questId = selected.id;
  dialog.sessionId = sessionId;
  dialog.dialogId = 0;
  dialog.questEntries = [selected, ...quests.filter((q) => q !== selected)].map((quest) => {
    const entry = new DialogQuestEntry();
    entry.questId = quest.id;
    entry.questName = quest.name;
    return entry;
  });
  dialog.dialogEntries = dialogEntries(selected, progressOf(player, selected.id), behaviorId);
  player.bus.send(dialog);
}

function sendChats(player: Player, npc: NpcInstance, quest: Quest): void {
  const messages = chatMessages(quest, progressOf(player, quest.id), npc.data.behaviorId);
  if (messages.length === 0) return;
  const report = new QuestReportServerPacket();
  report.npcIndex = npc.index;
  report.messages = messages;
  player.map?.broadcastNear(report, npc.x, npc.y);
}

function questUse(player: Player, reader: EoReader): void {
  const packet = QuestUseClientPacket.deserialize(reader);
  if (!inGame(player)) return;

  const npc = questNpc(player, packet.npcIndex);
  if (npc === null) return;
  const behaviorId = npc.data.behaviorId;
  const selection = selectQuest(player, behaviorId, packet.questId);
  if (selection === null) return;

  getProgress(player, selection.selected.id);
  player.interactNpcIndex = npc.index;
  const sessionId = player.generateSessionId();
  sendDialog(player, behaviorId, selection.quests, selection.selected, sessionId);
  sendChats(player, npc, selection.selected);
}

function questAccept(player: Player, reader: EoReader): void {
  const packet = QuestAcceptClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const sessionId = player.peekSessionId();
  if (sessionId === null || sessionId !== packet.sessionId) return;
  const npcIndex = player.interactNpcIndex;
  if (npcIndex === null || (packet.npcIndex !== 0 && packet.npcIndex !== npcIndex)) return;

  const npc = questNpc(player, npcIndex);
  if (npc === null) return;
  const behaviorId = npc.data.behaviorId;

  const quest = player.server.quests.get(packet.questId);
  if (quest === undefined) return;
  const progress = peekProgress(player, quest.id);
  if (progress === undefined) return;
  const state = currentState(quest, progress);
  if (state === undefined || !offersDialog(state, behaviorId)) return;

  const replyData = packet.replyTypeData;
  const actionId =
    replyData instanceof QuestAcceptClientPacket.ReplyTypeDataLink ? replyData.action : null;
  if (actionId !== null && !offersLink(state, behaviorId, actionId)) return;

  const nextSessionId = player.generateSessionId();
  const before = progress.state;
  const result = talkedToNpc(player, quest, behaviorId, actionId);
  if (!result.fired) return;

  const selection = selectQuest(player, behaviorId, quest.id);
  if (selection === null) return;
  if (progressOf(player, quest.id).state <= before) return;

  if (!result.warped) sendDialog(player, behaviorId, selection.quests, selection.selected, nextSessionId);
  sendChats(player, npc, selection.selected);
}

function argNumber(call: QuestCall, index: number, fallback: number): number {
  const arg = call.args[index];
  if (arg === undefined) return fallback;
  const value = typeof arg === 'number' ? arg : Number.parseInt(arg, 10);
  return Number.isNaN(value) ? fallback : Math.trunc(value);
}

function shortValue(value: number): number {
  return Math.max(0, Math.min(value, SHORT_MAX - 1));
}

function progressEntry(player: Player, quest: Quest, state: QuestState, progress: QuestProgress): QuestProgressEntry {
  const entry = new QuestProgressEntry();
  entry.name = quest.name;
  entry.description = state.desc;
  entry.icon = QuestRequirementIcon.Talk;
  entry.progress = 0;
  entry.target = 0;

  const find = (name: string) => state.rules.find((rule) => rule.name === name);
  const gotItems = find('gotitems');
  const killedNpcs = find('killednpcs');
  const killedPlayers = find('killedplayers');
  if (gotItems !== undefined) {
    entry.icon = QuestRequirementIcon.Item;
    entry.progress = player.character!.heldAmount(argNumber(gotItems, 0, 0));
    entry.target = argNumber(gotItems, 1, 1);
  } else if (find('equippeditem') !== undefined || find('unequippeditem') !== undefined) {
    entry.icon = QuestRequirementIcon.Item;
    entry.target = 1;
  } else if (killedNpcs !== undefined) {
    entry.icon = QuestRequirementIcon.Kill;
    entry.progress = progress.npcKills.get(argNumber(killedNpcs, 0, 0)) ?? 0;
    entry.target = argNumber(killedNpcs, 1, 1);
  } else if (killedPlayers !== undefined) {
    entry.icon = QuestRequirementIcon.Kill;
    entry.progress = progress.playerKills;
    entry.target = argNumber(killedPlayers, 0, 1);
  } else if (state.rules.some((r) => r.name === 'entercoord' || r.name === 'entermap' || r.name === 'leavemap')) {
    entry.icon = QuestRequirementIcon.Step;
  }
  entry.progress = shortValue(entry.progress);
  entry.target = shortValue(entry.target);
  return entry;
}

function questList(player: Player, reader: EoReader): void {
  const packet = QuestListClientPacket.deserialize(reader);
  if (!inGame(player)) return;
  const character = player.character!;

  const reply = new QuestListServerPacket();
  reply.page = packet.page;

  if (packet.page === QuestPage.Progress) {
    const entries: QuestProgressEntry[] = [];
    for (const progress of character.quests.values()) {
      if (progress.doneAt !== null && progress.state !== 0) continue;
      const quest = player.server.quests.get(progress.questId);
      if (quest === undefined || quest.visibility === 'hidden') continue;
      const state = currentState(quest, progress);
      if (state === undefined) continue;
      entries.push(progressEntry(player, quest, state, progress));
    }
    reply.questsCount = entries.length;
    const data = new QuestListServerPacket.PageDataProgress();
    data.questProgressEntries = entries;
    reply.pageData = data;
  } else if (packet.page === QuestPage.History) {
    const completed: string[] = [];
    for (const progress of character.quests.values()) {
      if (progress.doneAt === null || progress.state === 0) continue;
      const quest = player.server.quests.get(progress.questId);
      if (quest === undefined || quest.visibility !== 'visible') continue;
      completed.push(quest.name);
    }
    reply.questsCount = completed.length;
    const data = new QuestListServerPacket.PageDataHistory();
    data.completedQuests = completed;
    reply.pageData = data;
  } else {
    return;
  }

  player.bus.send(reply);
}

export function handleQuest(player: Player, action: number, reader: EoReader): void {
  switch (action) {
    case PacketAction.Use:
      questUse(player, reader);
      break;
    case PacketAction.Accept:
      questAccept(player, reader);
      break;
    case PacketAction.List:
      questList(player, reader);
      break;
    default:
      log.debug({ player: player.id, action }, 'unhandled Quest action');
  }
}
