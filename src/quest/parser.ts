export type QuestArg = string | number;

export interface QuestCall {
  name: string;
  args: QuestArg[];
}

export type QuestBranch = 'if' | 'elseif' | 'else';

export interface QuestAction extends QuestCall {
  branch?: QuestBranch;
  condition?: QuestCall;
}

export interface QuestRule extends QuestCall {
  gotoState: string | null;
  action: QuestCall | null;
  goal: boolean;
}

export interface QuestState {
  name: string;
  desc: string;
  actions: QuestAction[];
  rules: QuestRule[];
}

export type QuestVisibility = 'visible' | 'hidden' | 'hiddenEnd';

export interface ParsedQuest {
  name: string;
  version: number;
  visibility: QuestVisibility;
  disabled: boolean;
  states: Map<string, QuestState>;
  warnings: string[];
}

export const RULE_NAMES: ReadonlySet<string> = new Set([
  'always',
  'inputnpc',
  'talkedtonpc',
  'donedaily',
  'entermap',
  'entercoord',
  'leavemap',
  'leavecoord',
  'killednpcs',
  'killedplayers',
  'gotitems',
  'lostitems',
  'useditem',
  'equippeditem',
  'unequippeditem',
  'isgender',
  'isclass',
  'israce',
  'iswearing',
  'gotspell',
  'lostspell',
  'usedspell',
  'citizenof',
  'rolled',
  'statis',
  'statnot',
  'statgreater',
  'statless',
  'statbetween',
  'statrpn',
  'stateval',
]);

export const ACTION_NAMES: ReadonlySet<string> = new Set([
  'addnpctext',
  'addnpcinput',
  'addnpcchat',
  'setstate',
  'reset',
  'resetdaily',
  'end',
  'startquest',
  'resetquest',
  'setqueststate',
  'showhint',
  'quake',
  'quakeworld',
  'setmap',
  'setcoord',
  'playsound',
  'playmusic',
  'giveexp',
  'giveitem',
  'removeitem',
  'setclass',
  'setrace',
  'givekarma',
  'removekarma',
  'effectonplayer',
  'effectoncoord',
  'settitle',
  'setfiance',
  'setpartner',
  'sethome',
  'setstat',
  'givestat',
  'removestat',
  'roll',
]);

const STATE_KEYWORDS: ReadonlySet<string> = new Set([
  'desc',
  'action',
  'rule',
  'goal',
  'if',
  'elseif',
  'elif',
  'else',
  'goto',
  'state',
  'main',
]);

type Token =
  | { kind: 'ident'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'punct'; value: string };

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

function trimUnterminated(value: string): string {
  let end = value.length;
  while (end > 0 && isSpace(value[end - 1])) end--;
  let cut = end;
  if (value[cut - 1] === ';') cut--;
  while (cut > 0 && isSpace(value[cut - 1])) cut--;
  if (cut > 0 && value[cut - 1] === ')') end = cut - 1;
  return value.slice(0, end);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      i++;
      while (i < source.length && source[i] !== quote && source[i] !== '\n') {
        if (source[i] === '\\' && i + 1 < source.length && source[i + 1] !== '\n') {
          value += source[i + 1];
          i += 2;
          continue;
        }
        value += source[i];
        i++;
      }
      if (source[i] === quote) i++;
      else value = trimUnterminated(value);
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let value = c;
      i++;
      while (i < source.length && /[0-9.]/.test(source[i]!)) {
        value += source[i];
        i++;
      }
      tokens.push({ kind: 'number', value: Number.parseFloat(value) });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let value = c;
      i++;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i]!)) {
        value += source[i];
        i++;
      }
      tokens.push({ kind: 'ident', value });
      continue;
    }
    tokens.push({ kind: 'punct', value: c });
    i++;
  }
  return tokens;
}

class TokenStream {
  private position = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.position + offset];
  }

  next(): Token | undefined {
    return this.tokens[this.position++];
  }

  eatPunct(value: string): boolean {
    const token = this.peek();
    if (token?.kind === 'punct' && token.value === value) {
      this.position++;
      return true;
    }
    return false;
  }
}

function isPunct(token: Token | undefined, value: string): boolean {
  return token?.kind === 'punct' && token.value === value;
}

function keywordOf(token: Token | undefined): string | null {
  return token?.kind === 'ident' ? token.value.toLowerCase() : null;
}

interface ParsedCall {
  call: QuestCall;
  terminated: boolean;
}

function parseCall(stream: TokenStream, name: string): ParsedCall {
  const args: QuestArg[] = [];
  if (stream.eatPunct('(')) {
    for (;;) {
      const token = stream.peek();
      if (token === undefined) throw new Error(`unterminated argument list for ${name}`);
      if (isPunct(token, ')')) {
        stream.next();
        break;
      }
      if (isPunct(token, '}') || isPunct(token, '{')) break;
      if (token.kind === 'ident') {
        const keyword = token.value.toLowerCase();
        if (STATE_KEYWORDS.has(keyword) || isPunct(stream.peek(1), '(')) break;
      }
      stream.next();
      if (token.kind === 'string' || token.kind === 'number' || token.kind === 'ident') {
        args.push(token.value);
      }
    }
  }
  const terminated = stream.eatPunct(';');
  return { call: { name: name.toLowerCase(), args }, terminated };
}

function parseStateName(stream: TokenStream): string {
  const first = stream.next();
  if (first?.kind !== 'ident') throw new Error(`expected state name, got ${JSON.stringify(first)}`);
  let target = first.value;
  for (;;) {
    const part = stream.peek();
    if (part?.kind === 'number') target += String(part.value);
    else if (isPunct(part, '-')) target += '-';
    else break;
    stream.next();
  }
  stream.eatPunct(';');
  return target.toLowerCase();
}

function parseConsequence(stream: TokenStream): { gotoState: string | null; action: QuestCall | null } {
  const token = stream.peek();
  if (token?.kind !== 'ident') return { gotoState: null, action: null };
  const keyword = token.value.toLowerCase();
  if (keyword === 'goto') {
    stream.next();
    return { gotoState: parseStateName(stream), action: null };
  }
  if (STATE_KEYWORDS.has(keyword) || !isPunct(stream.peek(1), '(')) {
    return { gotoState: null, action: null };
  }
  stream.next();
  const { call } = parseCall(stream, token.value);
  if (call.name === 'setstate' && call.args.length > 0) {
    return { gotoState: String(call.args[0]).toLowerCase(), action: null };
  }
  return { gotoState: null, action: call };
}

function parseMain(stream: TokenStream, quest: ParsedQuest): void {
  if (!stream.eatPunct('{')) throw new Error('expected { after Main');
  while (!stream.eatPunct('}')) {
    const key = stream.next();
    if (key === undefined) throw new Error('unterminated Main block');
    if (key.kind !== 'ident') continue;
    const keyName = key.value.toLowerCase();
    if (keyName === 'questname') {
      const value = stream.peek();
      if (value?.kind === 'string' || value?.kind === 'ident') {
        stream.next();
        quest.name = String(value.value);
      }
    } else if (keyName === 'version') {
      const value = stream.peek();
      if (value?.kind === 'number') {
        stream.next();
        quest.version = value.value;
      } else if (value?.kind === 'string') {
        stream.next();
        quest.version = Number.parseFloat(value.value) || 0;
      }
    } else if (keyName === 'hidden') {
      quest.visibility = 'hidden';
    } else if (keyName === 'hidden_end') {
      quest.visibility = 'hiddenEnd';
    } else if (keyName === 'disabled') {
      quest.disabled = true;
    }
  }
}

function parseStateHeader(stream: TokenStream): string {
  let stateName = '';
  for (;;) {
    const part = stream.peek();
    if (part === undefined) throw new Error('unterminated state header');
    if (isPunct(part, '{')) break;
    stream.next();
    if (part.kind === 'ident') stateName += part.value;
    else if (part.kind === 'number') stateName += String(part.value);
    else if (part.kind === 'punct') stateName += part.value;
  }
  if (!stream.eatPunct('{')) throw new Error(`expected { after state ${stateName}`);
  return stateName;
}

function parseRule(stream: TokenStream, state: QuestState, quest: ParsedQuest, goal: boolean): void {
  const nameToken = stream.next();
  if (nameToken?.kind !== 'ident') {
    quest.warnings.push(`state ${state.name}: expected rule name`);
    return;
  }
  const { call, terminated } = parseCall(stream, nameToken.value);
  const consequence = terminated ? { gotoState: null, action: null } : parseConsequence(stream);
  if (consequence.gotoState !== null || consequence.action !== null) {
    state.rules.push({ ...call, ...consequence, goal });
    return;
  }
  if (!RULE_NAMES.has(call.name) && ACTION_NAMES.has(call.name)) {
    quest.warnings.push(`state ${state.name}: rule ${call.name} has no goto; treated as an action`);
    state.actions.push(call);
    return;
  }
  quest.warnings.push(`state ${state.name}: rule ${call.name} has no goto; ignored`);
}

function parseConditional(
  stream: TokenStream,
  state: QuestState,
  quest: ParsedQuest,
  branch: QuestBranch,
): void {
  let condition: QuestCall | undefined;
  if (branch !== 'else') {
    const conditionName = stream.next();
    if (conditionName?.kind !== 'ident') {
      quest.warnings.push(`state ${state.name}: expected condition after ${branch}`);
      return;
    }
    condition = parseCall(stream, conditionName.value).call;
  }
  const consequence = parseConsequence(stream);
  const action =
    consequence.gotoState !== null
      ? { name: 'setstate', args: [consequence.gotoState] }
      : consequence.action;
  if (action === null) {
    quest.warnings.push(`state ${state.name}: ${branch} without an action; ignored`);
    return;
  }
  state.actions.push(condition === undefined ? { ...action, branch } : { ...action, branch, condition });
}

function parseState(stream: TokenStream, quest: ParsedQuest): QuestState {
  const stateName = parseStateHeader(stream);
  const state: QuestState = { name: stateName, desc: '', actions: [], rules: [] };

  while (!stream.eatPunct('}')) {
    const entry = stream.next();
    if (entry === undefined) throw new Error(`unterminated state ${stateName}`);
    if (entry.kind !== 'ident') continue;
    const entryKind = entry.value.toLowerCase();

    if (entryKind === 'desc') {
      const value = stream.peek();
      if (value?.kind === 'string') {
        stream.next();
        state.desc = value.value;
      }
    } else if (entryKind === 'action') {
      const name = stream.next();
      if (name?.kind === 'ident') state.actions.push(parseCall(stream, name.value).call);
    } else if (entryKind === 'rule') {
      parseRule(stream, state, quest, false);
    } else if (entryKind === 'goal') {
      parseRule(stream, state, quest, true);
    } else if (entryKind === 'if') {
      parseConditional(stream, state, quest, 'if');
    } else if (entryKind === 'elseif' || entryKind === 'elif') {
      parseConditional(stream, state, quest, 'elseif');
    } else if (entryKind === 'else') {
      parseConditional(stream, state, quest, 'else');
    } else {
      state.actions.push(parseCall(stream, entry.value).call);
    }
  }
  return state;
}

export function parseQuest(source: string): ParsedQuest {
  const stream = new TokenStream(tokenize(source));
  const quest: ParsedQuest = {
    name: '',
    version: 0,
    visibility: 'visible',
    disabled: false,
    states: new Map(),
    warnings: [],
  };

  for (;;) {
    const token = stream.next();
    if (token === undefined) break;
    const keyword = keywordOf(token);
    if (keyword === 'main') {
      parseMain(stream, quest);
    } else if (keyword === 'state') {
      const state = parseState(stream, quest);
      const key = state.name.toLowerCase();
      if (quest.states.has(key)) quest.warnings.push(`duplicate state ${state.name}; ignored`);
      else quest.states.set(key, state);
    }
  }

  if (quest.states.size === 0) throw new Error('quest has no states');
  return quest;
}
