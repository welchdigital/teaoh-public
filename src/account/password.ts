import argon2 from 'argon2';

export const PASSWORD_VERSION = 1;

export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export class PasswordBusyError extends Error {
  constructor() {
    super('password hashing is overloaded');
    this.name = 'PasswordBusyError';
  }
}

export interface PasswordHashLimits {
  concurrency: number;
  queue: number;
}

const DEFAULT_LIMITS: PasswordHashLimits = { concurrency: 2, queue: 32 };

let currentLimits: () => PasswordHashLimits = () => DEFAULT_LIMITS;
let active = 0;
const waiting: Array<() => void> = [];

export function configurePasswordHashing(limits: () => PasswordHashLimits): void {
  currentLimits = limits;
}

export function passwordHashLoad(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}

async function acquire(): Promise<void> {
  const { concurrency, queue } = currentLimits();
  if (active < Math.max(1, concurrency)) {
    active++;
    return;
  }
  if (waiting.length >= Math.max(0, queue)) throw new PasswordBusyError();
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next !== undefined) next();
  else active--;
}

async function withHashSlot<T>(run: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await run();
  } finally {
    release();
  }
}

export function hashPassword(username: string, password: string): Promise<string> {
  return withHashSlot(() => argon2.hash(`${username}${password}`, ARGON2_OPTIONS));
}

export function verifyPassword(
  username: string,
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return withHashSlot(async () => {
    try {
      return await argon2.verify(passwordHash, `${username}${password}`);
    } catch {
      return false;
    }
  });
}
