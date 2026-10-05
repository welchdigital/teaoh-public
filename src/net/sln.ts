import type { SlnConfig, ServerConfig } from "../config.ts";
import { log } from "../log.ts";
import { SERVER_VERSION } from "../version.ts";

export const SLN_SOFTWARE = "TeaOH";
export const SLN_USER_AGENT = "TeaOH";

export type SlnResult = "ok" | "rejected" | "failed";

export interface SlnStatus {
  enabled: boolean;
  lastPingAt: number | null;
  lastResult: SlnResult | null;
  lastError: string | null;
}

export type SlnFetch = (url: string, init: RequestInit) => Promise<Response>;

const MAX_ERROR_LENGTH = 500;

export class SlnPinger {
  private readonly sln: SlnConfig;
  private readonly server: ServerConfig;
  private readonly onlineCount: () => number;
  private readonly fetcher: SlnFetch;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private inFlight: Promise<SlnStatus> | null = null;
  private lastPingAt: number | null = null;
  private lastResult: SlnResult | null = null;
  private lastError: string | null = null;

  constructor(
    sln: SlnConfig,
    server: ServerConfig,
    onlineCount: () => number,
    fetcher: SlnFetch = (url, init) => fetch(url, init),
  ) {
    this.sln = sln;
    this.server = server;
    this.onlineCount = onlineCount;
    this.fetcher = fetcher;
  }

  get status(): SlnStatus {
    return {
      enabled: this.sln.enabled,
      lastPingAt: this.lastPingAt,
      lastResult: this.lastResult,
      lastError: this.lastError,
    };
  }

  get advertisedPort(): number {
    return this.sln.port > 0 ? this.sln.port : this.server.port;
  }

  start(): void {
    this.stop();
    if (!this.sln.enabled) return;
    const intervalMs = Math.max(1, this.sln.rate) * 60_000;
    this.timer = setInterval(() => void this.ping(), intervalMs);
    this.timer.unref();
    void this.ping();
  }

  restart(): void {
    this.start();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pingNow(): Promise<SlnStatus> {
    return this.ping();
  }

  buildUrl(): string {
    const [clientMajor = "0", clientMinor = "0"] = this.server.maxVersion.split(".");
    const params = new URLSearchParams({
      software: SLN_SOFTWARE,
      v: SERVER_VERSION,
      retry: String(Math.max(1, this.sln.rate) * 60),
      host: this.sln.host,
      port: String(this.advertisedPort),
      name: this.sln.serverName,
      url: toUrl(this.sln.site || this.sln.host),
      zone: this.sln.zone,
      clientmajorversion: clientMajor,
      clientminorversion: clientMinor,
      pusers: String(this.onlineCount()),
      maxusers: String(this.server.maxPlayers),
      uptime: String(Math.floor((Date.now() - this.startedAt) / 1000)),
    });
    if (this.sln.clientUrl !== "") params.set("clienturl", this.sln.clientUrl);
    if (this.sln.discord !== "") params.set("discord", this.sln.discord);
    if (this.sln.facebook !== "") params.set("facebook", this.sln.facebook);
    if (this.sln.twitter !== "") params.set("twitter", this.sln.twitter);
    if (this.sln.youtube !== "") params.set("youtube", this.sln.youtube);
    const base = this.sln.url.endsWith("/") ? this.sln.url : `${this.sln.url}/`;
    return `${base}check?${params.toString()}`;
  }

  private ping(): Promise<SlnStatus> {
    if (this.inFlight !== null) return this.inFlight;
    this.inFlight = this.check().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async check(): Promise<SlnStatus> {
    const endpoint = this.buildUrl();
    try {
      const response = await this.fetcher(endpoint, {
        headers: { "User-Agent": SLN_USER_AGENT },
        signal: AbortSignal.timeout(45_000),
      });
      const body = (await response.text()).trim();
      this.lastPingAt = Date.now();
      if (!response.ok || isSlnError(body)) {
        this.lastResult = "rejected";
        this.lastError = truncate(`HTTP ${response.status}: ${body}`);
        log.warn({ cat: "server", status: response.status, body, endpoint }, "sln check-in rejected");
      } else {
        this.lastResult = "ok";
        this.lastError = null;
        log.info({ cat: "server", status: response.status, body }, "sln check-in ok");
      }
    } catch (err) {
      this.lastPingAt = Date.now();
      this.lastResult = "failed";
      this.lastError = truncate(String(err));
      log.warn({ cat: "server", err: String(err), endpoint }, "sln check-in failed");
    }
    return this.status;
  }
}

function truncate(text: string): string {
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}...` : text;
}

export function isSlnError(body: string): boolean {
  return body.split("\n").some((line) => /^[45]\d\d\b/.test(line.trim()));
}

export function toUrl(value: string): string {
  let url = value.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!url.endsWith("/")) url += "/";
  return url;
}
