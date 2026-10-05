import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { log } from './log.ts';

export const DEFAULT_LANG = {
  announce_freeze: 'Attention!! {victim} movement has been frozen -{name}',
  announce_unfreeze: 'Attention!! {victim} movement has been released -{name}',
  announce_remove: 'Attention!! {victim} has been removed from the game -{name} [{method}]',
  announce_mute: 'Attention!! {victim} has been muted -{name}',
  announce_global: 'World communications changed to: {state} -{name}',
  global_locked: 'This channel is temporarily disabled',
  wedding_start: 'Very well, the ceremony will start in {delay} seconds.',
  wedding_one:
    'we are here at the invitation of {partner} and {name}, who have come before us to join together in marriage.',
  wedding_two:
    'their relationship is based on love, respect, and a determination to face the future together in health or sickness, in joy and sorrow.',
  wedding_do_you:
    '{partner}, do you take {name} to be your partner, and promise to love, comfort and stay together as long as you both shall live?',
  wedding_i_do: 'Yes, i do',
  wedding_three:
    'Let these rings be given and received as a token of your affection, sincerity and trust in one another.',
  wedding_four: 'Please place these rings on eachothers finger..',
  wedding_five:
    '{partner} and {name} have consented together in marriage. And are now partners for as long you both shall live.',
  wedding_end: 'Congratulations to the couple!',
  wedding_error: "I'm sorry, something went wrong..",
  evacuate_warning: 'Warning! - please leave this map in {seconds} seconds or be sent to jail.',
  evacuate_last_warning: 'Last warning! - leave this map in {seconds} seconds or be sent to jail.',
  shutdown_warning: 'Warning! - the server will shut down in {time}.',
  shutdown_cancelled: 'The server shutdown has been cancelled.',
  guild_joined: '*** {member} has joined the guild. Recruited by {recruiter}.',
  guild_left: '*** {member} has left the guild.',
  guild_kicked: '*** {member} has left the guild. Kicked by {name}.',
  guild_disbanded: '*** Guild has been disbanded by {name}.',
  arena_aborted: 'The event was aborted, last opponent left -server',
} as const;

export type LangKey = keyof typeof DEFAULT_LANG;
export type LangStrings = Record<LangKey, string>;
export type LangValues = Record<string, string | number>;
export type LangWarn = (message: string) => void;

export const DEFAULT_LANG_NAME = 'en';
export const LANG_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

const defaultWarn: LangWarn = (message) => log.warn({ cat: 'config' }, message);

let current: LangStrings = defaultLang();

function defaultLang(): LangStrings {
  return { ...DEFAULT_LANG };
}

function isLangKey(key: string): key is LangKey {
  return Object.hasOwn(DEFAULT_LANG, key);
}

export function langFilePath(configPath: string, name: string): string {
  return join(dirname(configPath), 'lang', `${name}.toml`);
}

export function parseLang(source: string, file: string, warn: LangWarn = defaultWarn): LangStrings {
  const strings = defaultLang();
  for (const [key, value] of Object.entries(parseToml(source))) {
    if (!isLangKey(key)) {
      warn(`${file}: unknown lang key "${key}"`);
    } else if (typeof value !== 'string') {
      warn(`${file}: lang key "${key}" must be a string; using the default`);
    } else {
      strings[key] = value;
    }
  }
  return strings;
}

export function readLangFile(path: string, warn: LangWarn = defaultWarn): LangStrings {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    warn(`${path}: ${code === 'ENOENT' ? 'not found' : String(err)}; using the built-in English strings`);
    return defaultLang();
  }
  try {
    return parseLang(source, path, warn);
  } catch (err) {
    warn(`${path}: ${err instanceof Error ? err.message : String(err)}; using the built-in English strings`);
    return defaultLang();
  }
}

export function loadLang(configPath: string, name: string, warn: LangWarn = defaultWarn): LangStrings {
  const strings = readLangFile(langFilePath(configPath, name), warn);
  setLang(strings);
  return strings;
}

export function setLang(strings: LangStrings): void {
  current = { ...strings };
}

export function resetLang(): void {
  current = defaultLang();
}

export function lang(key: LangKey, values: LangValues = {}): string {
  return renderTemplate(current[key], values);
}

export function renderTemplate(template: string, values: LangValues): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  );
}
