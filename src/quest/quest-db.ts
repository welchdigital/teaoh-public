import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../log.ts';
import { parseQuest, type ParsedQuest, type QuestState } from './parser.ts';

export interface Quest extends ParsedQuest {
  id: number;
  stateList: QuestState[];
}

export class QuestDb {
  private readonly quests = new Map<number, Quest>();

  static load(dataDir: string): QuestDb {
    const db = new QuestDb();
    const roots = [join(dataDir, 'quests'), join(dataDir, 'quests', 'quests')];
    for (const root of roots) {
      let files: string[] = [];
      try {
        files = readdirSync(root)
          .filter((f) => f.endsWith('.txt') || f.endsWith('.eqf'))
          .sort();
      } catch {
        continue;
      }
      for (const file of files) {
        const id = Number.parseInt(file, 10);
        if (!Number.isInteger(id) || id <= 0 || db.quests.has(id)) continue;
        try {
          const parsed = parseQuest(readFileSync(join(root, file), 'utf8'));
          for (const warning of parsed.warnings) log.warn({ file, warning }, 'quest script warning');
          db.quests.set(id, { ...parsed, id, stateList: [...parsed.states.values()] });
        } catch (err) {
          log.warn({ file, err: String(err) }, 'failed to parse quest');
        }
      }
    }
    log.info({ quests: db.quests.size }, 'quests loaded');
    return db;
  }

  static empty(): QuestDb {
    return new QuestDb();
  }

  get(id: number): Quest | undefined {
    return this.quests.get(id);
  }

  get all(): Iterable<Quest> {
    return this.quests.values();
  }
}
