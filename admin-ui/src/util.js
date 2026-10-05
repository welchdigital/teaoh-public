export function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const numeric = typeof value === 'number' || /^\d+$/.test(String(value));
  const date = numeric ? new Date(Number(value)) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

export function formatTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatFull(value) {
  const d = toDate(value);
  return d ? d.toLocaleString() : '';
}

export function formatSpan(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function formatRelative(value, now = Date.now()) {
  const d = toDate(value);
  if (!d) return '—';
  const diff = Math.round((d.getTime() - now) / 1000);
  if (Math.abs(diff) < 5) return 'just now';
  const text = formatSpan(Math.abs(diff));
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export function formatCountdown(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export function formatUptime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

export function formatMinutes(minutes) {
  if (minutes === null || minutes === undefined) return 'permanent';
  return formatSpan(minutes * 60);
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatNumber(n) {
  if (typeof n === 'number' && Number.isFinite(n)) return n.toLocaleString();
  return n === null || n === undefined || n === '' ? '—' : String(n);
}

export function formatMs(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return `${n < 10 ? n.toFixed(2) : n.toFixed(1)} ms`;
}

export function textOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const CATEGORY_COLORS = {
  chat: '#4c8dff',
  command: '#a371f7',
  admin: '#a371f7',
  audit: '#a371f7',
  combat: '#d5a021',
  npc_kill: '#d5a021',
  pk: '#f05561',
  death: '#f05561',
  item: '#3fb950',
  chest: '#3fb950',
  trade: '#3fb950',
  connection: '#6cc8d8',
  warp: '#6cc8d8',
  guild: '#c88fd8',
  party: '#c88fd8',
  quest: '#e0b060',
  server: '#8b98a8',
  sln: '#8b98a8',
  debug: '#5a6673',
  error: '#f05561',
};

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_COLORS);

export function categoryColor(category) {
  return CATEGORY_COLORS[category] || '#8b98a8';
}

export const LOG_LEVELS = [
  { value: 10, label: 'trace' },
  { value: 20, label: 'debug' },
  { value: 30, label: 'info' },
  { value: 40, label: 'warn' },
  { value: 50, label: 'error' },
  { value: 60, label: 'fatal' },
];

export function levelName(level) {
  if (typeof level === 'string') return level.toLowerCase();
  if (level >= 60) return 'fatal';
  if (level >= 50) return 'error';
  if (level >= 40) return 'warn';
  if (level >= 30) return 'info';
  if (level >= 20) return 'debug';
  return 'trace';
}

export function levelTone(level) {
  const name = levelName(level);
  if (name === 'fatal' || name === 'error') return 'red';
  if (name === 'warn') return 'yellow';
  if (name === 'info') return 'blue';
  return 'dim';
}

export const ADMIN_LEVELS = ['Player', 'Spy', 'Light Guide', 'Guardian', 'Game Master', 'High GM'];

export function adminLabel(level) {
  return ADMIN_LEVELS[level] || `Admin ${level}`;
}

export const GENDERS = ['Female', 'Male'];

const ITEM_TYPES = [
  'Static', 'Unknown', 'Money', 'Heal', 'Teleport', 'Spell', 'EXP reward', 'Stat reward',
  'Skill reward', 'Key', 'Weapon', 'Shield', 'Armor', 'Hat', 'Boots', 'Gloves', 'Accessory',
  'Belt', 'Necklace', 'Ring', 'Armlet', 'Bracer', 'Beer', 'Effect potion', 'Hair dye', 'Cure curse',
];

const NPC_TYPES = {
  0: 'Friendly', 1: 'Passive', 2: 'Aggressive', 6: 'Shop', 7: 'Inn', 9: 'Bank', 10: 'Barber',
  11: 'Guild', 12: 'Priest', 13: 'Lawyer', 14: 'Skills', 15: 'Quest',
};

export function itemTypeLabel(type) {
  if (typeof type === 'number') return ITEM_TYPES[type] || `type ${type}`;
  return type ? String(type) : '';
}

export function npcTypeLabel(type) {
  if (typeof type === 'number') return NPC_TYPES[type] || `type ${type}`;
  return type ? String(type) : '';
}

export function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

export function toInt(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

export function percent(value, max) {
  if (!max || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  let out = '';
  for (const v of values) out += alphabet[v % alphabet.length];
  return out;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return fallbackCopy(text);
  }
  return fallbackCopy(text);
}

function fallbackCopy(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

export function debounce(fn, ms) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}
