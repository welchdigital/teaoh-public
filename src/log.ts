import { pino, type Level } from 'pino';
import { eventLog } from './admin/event-log.ts';

const LEVELS: readonly string[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

export function isLogLevel(value: string): value is Level | 'silent' {
  return LEVELS.includes(value);
}

function initialLevel(): string {
  const env = process.env['TEAOH_LOG_LEVEL']?.trim().toLowerCase() ?? '';
  return isLogLevel(env) ? env : 'info';
}

const usePretty =
  process.env['NODE_ENV'] !== 'production' && process.env['TEAOH_LOG_JSON'] !== '1';

let consoleStream: NodeJS.WritableStream = process.stdout;
if (usePretty) {
  try {
    const { default: prettyFactory } = await import('pino-pretty');
    consoleStream = prettyFactory({
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    });
  } catch {
    consoleStream = process.stdout;
  }
}

export const log = pino(
  {
    level: initialLevel(),
    base: null,
    hooks: {
      logMethod(args, method, level) {
        try {
          eventLog.ingest(level, args);
        } catch {
          eventLog.record('error', 'event log capture failed', {}, 50);
        }
        method.apply(this, args);
      },
    },
  },
  consoleStream,
);

export function setLogLevel(level: string): boolean {
  const normalized = level.trim().toLowerCase();
  if (!isLogLevel(normalized)) return false;
  log.level = normalized;
  return true;
}
