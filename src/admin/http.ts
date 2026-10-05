import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_DURATION_MINUTES } from './duration.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly headers: Record<string, string>;

  constructor(status: number, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.headers = headers;
  }
}

export type JsonBody = Record<string, unknown>;

export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    req.resume();
    throw new HttpError(413, `request body larger than ${maxBytes} bytes`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > maxBytes) {
      req.resume();
      throw new HttpError(413, `request body larger than ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function parseJsonObject(raw: Buffer): JsonBody {
  if (raw.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'request body is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'request body must be a JSON object');
  }
  return value as JsonBody;
}

export function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const type = value.split(';')[0]!.trim().toLowerCase();
  return type === 'application/json' || type.endsWith('+json');
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body, replacer);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function iso(value: Date | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === 'number' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface IntOptions {
  min?: number;
  max?: number;
}

function checkRange(key: string, value: number, options: IntOptions): number {
  if (options.min !== undefined && value < options.min) {
    throw new HttpError(400, `${key} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new HttpError(400, `${key} must be <= ${options.max}`);
  }
  return value;
}

export function requireInt(body: JsonBody, key: string, options: IntOptions = {}): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HttpError(400, `${key} must be an integer`);
  }
  return checkRange(key, value, options);
}

export function optionalInt(body: JsonBody, key: string, options: IntOptions = {}): number | undefined {
  if (body[key] === undefined || body[key] === null) return undefined;
  return requireInt(body, key, options);
}

export function requireString(body: JsonBody, key: string, options: { min?: number; max?: number } = {}): string {
  const value = body[key];
  if (typeof value !== 'string') throw new HttpError(400, `${key} must be a string`);
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (options.min !== undefined && length < options.min) {
    throw new HttpError(400, `${key} must be at least ${options.min} characters`);
  }
  if (options.max !== undefined && length > options.max) {
    throw new HttpError(400, `${key} must be at most ${options.max} characters`);
  }
  return trimmed;
}

export function optionalString(body: JsonBody, key: string, max?: number): string | null {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new HttpError(400, `${key} must be a string`);
  const trimmed = value.trim();
  if (max !== undefined && [...trimmed].length > max) {
    throw new HttpError(400, `${key} must be at most ${max} characters`);
  }
  return trimmed === '' ? null : trimmed;
}

export function optionalBool(body: JsonBody, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new HttpError(400, `${key} must be a boolean`);
  return value;
}

export function requireDuration(body: JsonBody, key = 'durationMinutes'): number | null {
  if (!(key in body)) throw new HttpError(400, `${key} is required (a positive integer, or null for permanent)`);
  const value = body[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(400, `${key} must be a positive integer or null`);
  }
  if (value > MAX_DURATION_MINUTES) {
    throw new HttpError(400, `${key} must be at most ${MAX_DURATION_MINUTES} (100 years), or null for permanent`);
  }
  return value;
}

export function pathInt(params: Record<string, string>, key: string): number {
  const raw = params[key] ?? '';
  if (!/^\d+$/.test(raw)) throw new HttpError(404, `invalid ${key}`);
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) throw new HttpError(404, `invalid ${key}`);
  return value;
}

export function queryInt(query: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = query.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new HttpError(400, `${key} must be an integer`);
  return Math.min(max, Math.max(min, value));
}

export function queryBool(query: URLSearchParams, key: string): boolean | undefined {
  const raw = query.get(key);
  if (raw === null || raw === '' || raw === 'all') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new HttpError(400, `${key} must be true or false`);
}

export interface Page {
  offset: number;
  limit: number;
}

export function pageOf(query: URLSearchParams): Page {
  return { offset: queryInt(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER), limit: queryInt(query, 'limit', 50, 1, 200) };
}
