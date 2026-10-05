import type { Actor } from './actions.ts';
import type { JsonBody } from './http.ts';
import type { GameServer } from '../server.ts';

export interface ApiContext {
  game: GameServer;
  actor: Actor;
  params: Record<string, string>;
  query: URLSearchParams;
  body: JsonBody;
}

export type ApiHandler = (ctx: ApiContext) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: ApiHandler;
}

export type RouteMatch =
  | { kind: 'found'; handler: ApiHandler; params: Record<string, string> }
  | { kind: 'method'; allowed: string[] }
  | { kind: 'none' };

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: ApiHandler): this {
    const keys: string[] = [];
    const source = path
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  get(path: string, handler: ApiHandler): this {
    return this.add('GET', path, handler);
  }

  post(path: string, handler: ApiHandler): this {
    return this.add('POST', path, handler);
  }

  patch(path: string, handler: ApiHandler): this {
    return this.add('PATCH', path, handler);
  }

  delete(path: string, handler: ApiHandler): this {
    return this.add('DELETE', path, handler);
  }

  match(method: string, path: string): RouteMatch {
    const allowed: string[] = [];
    for (const route of this.routes) {
      const found = route.pattern.exec(path);
      if (found === null) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        let value = found[index + 1] ?? '';
        try {
          value = decodeURIComponent(value);
        } catch {
          value = '';
        }
        params[key] = value;
      });
      return { kind: 'found', handler: route.handler, params };
    }
    return allowed.length > 0 ? { kind: 'method', allowed } : { kind: 'none' };
  }
}
