import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { AdminApiConfig } from '../config.ts';
import { log } from '../log.ts';
import type { GameServer } from '../server.ts';
import { ActionError, apiActor } from './actions.ts';
import { AuthGuard, extractKey, keyFingerprint } from './auth.ts';
import { HttpError, isJsonContentType, parseJsonObject, readBody, sendJson, type JsonBody } from './http.ts';
import { buildRouter } from './routes.ts';
import type { Router } from './router.ts';

export const MIN_KEY_LENGTH = 16;
export const MAX_BODY_BYTES = 256 * 1024;
const MAX_ACTOR_LENGTH = 32;
const CORS_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
const CORS_HEADERS = 'content-type, x-admin-key, x-admin-actor, authorization';
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
const UI_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' http: https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

interface CachedFile {
  mtimeMs: number;
  size: number;
  body: Buffer;
}

export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '[::1]' ||
    value === '::ffff:127.0.0.1' ||
    /^127(\.\d{1,3}){3}$/.test(value)
  );
}

export function adminApiStartupProblem(config: AdminApiConfig): string | null {
  if (isLoopbackHost(config.host)) return null;
  if (config.key === '') {
    return `admin API not started: [admin] key is empty and host ${config.host} is not loopback; set a key of at least ${MIN_KEY_LENGTH} characters or bind to 127.0.0.1`;
  }
  if (config.key.length < MIN_KEY_LENGTH) {
    return `admin API not started: [admin] key is shorter than ${MIN_KEY_LENGTH} characters and host ${config.host} is not loopback`;
  }
  return null;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const WILDCARD_HOSTS = new Set(['', '0.0.0.0', '::', '[::]']);

interface HostPort {
  name: string;
  port: number | null;
}

export function parseHostHeader(value: string): HostPort | null {
  const text = value.trim().toLowerCase();
  const bare = /^[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*$/.test(text) ? `[${text}]` : text;
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9_-]+(?:\.[a-z0-9_-]+)*)(?::(\d{1,5}))?$/.exec(bare);
  if (match === null) return null;
  return { name: match[1]!, port: match[2] === undefined ? null : Number(match[2]) };
}

export function hostAllowed(
  header: string | undefined,
  config: Pick<AdminApiConfig, 'key' | 'host' | 'allowedHosts'>,
  port: number | null,
): boolean {
  const keyed = config.key !== '';
  if (keyed && config.allowedHosts.length === 0) return true;
  if (header === undefined) return false;
  const host = parseHostHeader(header);
  if (host === null) return false;
  const bind = parseHostHeader(config.host);
  const local =
    LOOPBACK_HOSTNAMES.has(host.name) ||
    (keyed && bind !== null && !WILDCARD_HOSTS.has(bind.name) && bind.name === host.name);
  if (local && (host.port === null || host.port === port)) return true;
  if (!keyed) return false;
  return config.allowedHosts.some((entry) => {
    const allowed = parseHostHeader(entry);
    return allowed !== null && allowed.name === host.name && (allowed.port === null || allowed.port === host.port);
  });
}

function sanitizeActor(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const cleaned = (raw ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, MAX_ACTOR_LENGTH);
  return cleaned === '' ? 'api' : cleaned;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

export class AdminApi {
  private server: Server | null = null;
  private readonly game: GameServer;
  private readonly config: AdminApiConfig;
  private readonly guard: AuthGuard;
  private readonly keyFingerprint: string | null;
  private readonly router: Router = buildRouter();
  private readonly files = new Map<string, CachedFile>();
  private boundPort: number | null = null;

  constructor(game: GameServer, config: AdminApiConfig) {
    this.game = game;
    this.config = config;
    this.guard = new AuthGuard(config.key, config.maxAuthFailures, config.authLockoutSeconds);
    this.keyFingerprint = keyFingerprint(config.key);
  }

  get port(): number | null {
    return this.boundPort;
  }

  async start(): Promise<number | null> {
    const problem = adminApiStartupProblem(this.config);
    if (problem !== null) {
      log.error({ cat: 'server', host: this.config.host }, problem);
      return null;
    }
    if (this.config.key === '') {
      log.warn(
        { cat: 'server', host: this.config.host },
        'admin API is running WITHOUT authentication on loopback (set [admin] key); cross-origin browser access is disabled',
      );
    }
    const server = createServer((req, res) => void this.handle(req, res));
    server.requestTimeout = 30_000;
    server.headersTimeout = 15_000;
    const port = await new Promise<number | null>((resolveListen) => {
      const onError = (err: Error): void => {
        log.error({ cat: 'server', err: String(err), port: this.config.port }, 'admin API failed to start');
        resolveListen(null);
      };
      server.once('error', onError);
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', onError);
        server.on('error', (err) => log.error({ cat: 'server', err: String(err) }, 'admin API error'));
        const address = server.address();
        resolveListen(typeof address === 'object' && address !== null ? address.port : this.config.port);
      });
    });
    if (port === null) return null;
    this.server = server;
    this.boundPort = port;
    log.info({ cat: 'server', host: this.config.host, port }, 'admin API listening');
    return port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) return;
    this.server = null;
    this.boundPort = null;
    await new Promise<void>((done) => {
      server.close(() => done());
      server.closeAllConnections();
    });
  }

  private applySecurityHeaders(res: ServerResponse, csp: string): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', csp);
  }

  private corsAllowed(origin: string): boolean {
    const configured = this.config.corsOrigin.trim();
    if (configured === '') return false;
    if (configured === '*') return !this.guard.open;
    return configured
      .split(',')
      .map((entry) => entry.trim().replace(/\/+$/, ''))
      .includes(origin.replace(/\/+$/, ''));
  }

  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin === '' || !this.corsAllowed(origin)) return;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
    res.setHeader('Access-Control-Allow-Headers', CORS_HEADERS);
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    let path = '/';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
      path = url.pathname.replace(/\/+$/, '') || '/';
    } catch {
      this.applySecurityHeaders(res, API_CSP);
      sendJson(res, 400, { error: 'bad request' });
      return;
    }
    const isApi = path === '/api' || path.startsWith('/api/');
    this.applySecurityHeaders(res, isApi ? API_CSP : UI_CSP);
    if (!hostAllowed(req.headers.host, this.config, this.boundPort ?? this.config.port)) {
      req.resume();
      log.debug({ cat: 'admin', ip: clientIp(req), host: req.headers.host, path }, 'admin API rejected Host header');
      sendJson(res, 421, { error: 'host not allowed' });
      return;
    }
    this.applyCors(req, res);

    if (method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (!isApi) {
      await this.serveUi(req, res, method, path);
      return;
    }

    try {
      const auth = this.guard.check(clientIp(req), extractKey(req.headers));
      if (!auth.ok) {
        req.resume();
        if (auth.status === 429) {
          log.warn({ cat: 'admin', ip: clientIp(req), path }, 'admin API auth locked out');
          sendJson(res, 429, { error: 'too many failed authentication attempts; try again later' }, {
            'Retry-After': String(auth.retryAfter),
          });
        } else {
          log.warn({ cat: 'admin', ip: clientIp(req), path }, 'admin API unauthorized request');
          sendJson(res, 401, { error: 'unauthorized' });
        }
        return;
      }

      const match = this.router.match(method, path);
      if (match.kind === 'none') throw new HttpError(404, 'not found');
      if (match.kind === 'method') {
        throw new HttpError(405, 'method not allowed', { Allow: [...new Set(match.allowed)].join(', ') });
      }

      const body = await this.readRequestBody(req, method);
      const actor = apiActor(sanitizeActor(req.headers['x-admin-actor']), clientIp(req), this.keyFingerprint);
      if (method !== 'GET') {
        log.info({ cat: 'admin', ip: actor.sourceIp, actor: actor.name, method, path }, 'admin API request');
      }
      const result = await match.handler({ game: this.game, actor, params: match.params, query: url.searchParams, body });
      sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      this.sendError(res, err, method, path);
    }
  }

  private async readRequestBody(req: IncomingMessage, method: string): Promise<JsonBody> {
    if (method === 'GET' || method === 'HEAD') {
      req.resume();
      return {};
    }
    const declared = Number(req.headers['content-length'] ?? 0);
    const chunked = req.headers['transfer-encoding'] !== undefined;
    const hasBody = chunked || (Number.isFinite(declared) && declared > 0);
    if (method === 'DELETE' && !hasBody) {
      req.resume();
      return {};
    }
    if (!isJsonContentType(req.headers['content-type'])) {
      req.resume();
      throw new HttpError(415, 'content-type must be application/json');
    }
    return parseJsonObject(await readBody(req, MAX_BODY_BYTES));
  }

  private sendError(res: ServerResponse, err: unknown, method: string, path: string): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message }, err.headers);
      return;
    }
    if (err instanceof ActionError) {
      sendJson(res, err.status, { error: err.message });
      return;
    }
    log.error(
      { cat: 'server', err: err instanceof Error ? (err.stack ?? err.message) : String(err), method, path },
      'admin API error',
    );
    sendJson(res, 500, { error: 'internal error' });
  }

  private async serveUi(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> {
    req.resume();
    if (method !== 'GET' && method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }).end('method not allowed');
      return;
    }
    const dir = resolve(this.config.uiDir);
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad request');
      return;
    }
    const rel = decoded === '/' || extname(decoded) === '' ? 'index.html' : decoded.replace(/^\/+/, '');
    const file = resolve(dir, rel);
    if (file !== dir && !file.startsWith(dir + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('forbidden');
      return;
    }
    const cached = await this.loadFile(file);
    if (cached === null) {
      if (rel === 'index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(method === 'HEAD' ? undefined : uiMissingPage());
      } else {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      }
      return;
    }
    const immutable = rel.startsWith('assets/');
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(cached.size),
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(method === 'HEAD' ? undefined : cached.body);
  }

  private async loadFile(file: string): Promise<CachedFile | null> {
    let info;
    try {
      info = await stat(file);
    } catch {
      this.files.delete(file);
      return null;
    }
    if (!info.isFile()) return null;
    const cached = this.files.get(file);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    try {
      const body = await readFile(file);
      const entry = { mtimeMs: info.mtimeMs, size: body.length, body };
      this.files.set(file, entry);
      return entry;
    } catch {
      return null;
    }
  }
}

function uiMissingPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>teaoh admin</title>
<style>body{font-family:system-ui,sans-serif;background:#0e1116;color:#d7e0ea;max-width:640px;margin:4rem auto;padding:0 1rem;line-height:1.6}code{background:#1c232d;padding:.15rem .4rem;border-radius:4px}</style>
</head><body>
<h1>teaoh admin API</h1>
<p>The API is running, but the admin web interface hasn't been built.</p>
<p>Build it and reload this page:</p>
<pre><code>cd admin-ui
npm install
npm run build</code></pre>
<p>API endpoints live under <code>/api/</code>.</p>
</body></html>`;
}
