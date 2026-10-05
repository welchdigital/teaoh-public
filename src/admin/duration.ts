export type DurationResult =
  | { ok: true; minutes: number | null }
  | { ok: false; error: string };

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86_400,
  day: 86_400,
  days: 86_400,
  w: 604_800,
  wk: 604_800,
  week: 604_800,
  weeks: 604_800,
  mon: 2_592_000,
  month: 2_592_000,
  months: 2_592_000,
  y: 31_536_000,
  yr: 31_536_000,
  yrs: 31_536_000,
  year: 31_536_000,
  years: 31_536_000,
};

const PERMANENT = new Set(['perm', 'permanent', 'forever', 'never']);
export const MAX_DURATION_MINUTES = 60 * 24 * 365 * 100;

export function parseDuration(input: string): DurationResult {
  const text = input.trim().toLowerCase();
  if (text === '') return { ok: false, error: 'Missing duration.' };
  if (PERMANENT.has(text)) return { ok: true, minutes: null };
  if (/^\d+$/.test(text)) return checked(Number.parseInt(text, 10) * 60, input);

  const pattern = /(\d+)\s*([a-z]+)/g;
  let total = 0;
  let consumed = '';
  for (const match of text.matchAll(pattern)) {
    const unit = UNIT_SECONDS[match[2]!];
    if (unit === undefined) return invalid(input);
    total += Number.parseInt(match[1]!, 10) * unit;
    consumed += match[0];
  }
  if (consumed.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return invalid(input);
  return checked(total, input);
}

function checked(seconds: number, input: string): DurationResult {
  if (!Number.isFinite(seconds) || seconds <= 0) return invalid(input);
  const minutes = Math.ceil(seconds / 60);
  if (minutes > MAX_DURATION_MINUTES) return { ok: false, error: `Duration "${input}" is too long.` };
  return { ok: true, minutes };
}

function invalid(input: string): DurationResult {
  return {
    ok: false,
    error: `Invalid duration "${input}" (use e.g. 30m, 2h, 1d, 1w, 1mon, 1y, or a number of minutes).`,
  };
}

export function describeMinutes(minutes: number | null): string {
  if (minutes === null) return 'permanently';
  const parts: string[] = [];
  let rest = minutes;
  for (const [unit, size] of [
    ['w', 10_080],
    ['d', 1_440],
    ['h', 60],
  ] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }
  if (rest > 0 || parts.length === 0) parts.push(`${rest}m`);
  return `for ${parts.join(' ')}`;
}
