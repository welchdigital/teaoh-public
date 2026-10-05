import { SHORT_MAX, decodeNumber } from 'eolib';
import { isIP, type Socket } from 'node:net';
import type { WebSocket } from 'ws';
import { log } from '../log.ts';
import { normalizeIp } from './ip.ts';

export const MAX_PROXY_HEADER = 107;
const PROXY_SIGNATURE = 'PROXY ';

function validPort(value: string | undefined): boolean {
  return value !== undefined && /^\d{1,5}$/.test(value) && Number(value) <= 65_535;
}

export function parseProxyV1(line: string): string | null {
  const parts = line.split(' ');
  if (parts.length !== 6 || parts[0] !== 'PROXY') return null;
  const [, protocol, source, destination, sourcePort, destinationPort] = parts;
  const version = protocol === 'TCP4' ? 4 : protocol === 'TCP6' ? 6 : 0;
  if (version === 0 || source === undefined || destination === undefined) return null;
  if (isIP(source) !== version || isIP(destination) !== version) return null;
  if (!validPort(sourcePort) || !validPort(destinationPort)) return null;
  return normalizeIp(source);
}

export const MAX_PAYLOAD = SHORT_MAX - 1;
const MIN_PAYLOAD = 2;
export const MAX_FRAME = MAX_PAYLOAD + 2;
export const DEFAULT_MAX_SEND_BUFFER = 1_048_576;
const END_TIMEOUT_MS = 2_000;

const WIRE_DEBUG = process.env['TEAOH_SLN_DEBUG'] === '1';
function wireLog(ip: string, dir: 'recv' | 'send', bytes: Uint8Array): void {
  log.info({ cat: 'wire', ip, dir, hex: Buffer.from(bytes).toString('hex') }, 'wire');
}

export interface GameSocket {
  readonly remoteAddress: string;
  readonly ready: boolean;
  onReady(cb: () => void): void;
  onPayload(cb: (payload: Uint8Array) => void): void;
  onClose(cb: () => void): void;
  sendFrame(frame: Uint8Array): void;
  end(): void;
  destroy(): void;
}

export class TcpGameSocket implements GameSocket {
  remoteAddress: string;
  private readonly socket: Socket;
  private readonly maxSendBuffer: number;
  private buffer: Buffer = Buffer.alloc(0);
  private payloadCb: ((payload: Uint8Array) => void) | undefined;
  private closeCb: (() => void) | undefined;
  private readyCb: (() => void) | undefined;
  private ending = false;
  private proxyPending: boolean;

  constructor(socket: Socket, expectProxyHeader = false, maxSendBuffer = DEFAULT_MAX_SEND_BUFFER) {
    this.socket = socket;
    this.remoteAddress = normalizeIp(socket.remoteAddress) ?? 'unknown';
    this.proxyPending = expectProxyHeader;
    this.maxSendBuffer = maxSendBuffer;
    socket.setNoDelay(true);
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.closeCb?.());
  }

  get ready(): boolean {
    return !this.proxyPending;
  }

  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyCb = cb;
  }

  private consumeProxyHeader(): boolean {
    const avail = Math.min(this.buffer.length, PROXY_SIGNATURE.length);
    for (let i = 0; i < avail; i++) {
      if (this.buffer[i] !== PROXY_SIGNATURE.charCodeAt(i)) {
        this.rejectProxyHeader('missing PROXY header from trusted proxy');
        return false;
      }
    }
    const window = this.buffer.subarray(0, MAX_PROXY_HEADER);
    const nl = window.indexOf('\r\n');
    if (nl === -1) {
      if (this.buffer.length >= MAX_PROXY_HEADER) this.rejectProxyHeader('oversized PROXY header');
      return false;
    }
    const address = parseProxyV1(window.subarray(0, nl).toString('latin1'));
    if (address === null) {
      this.rejectProxyHeader('malformed PROXY header');
      return false;
    }
    this.remoteAddress = address;
    this.buffer = this.buffer.subarray(nl + 2);
    this.proxyPending = false;
    return true;
  }

  private rejectProxyHeader(reason: string): void {
    log.warn({ cat: 'connection', ip: this.remoteAddress }, reason);
    this.socket.destroy();
  }

  private onData(chunk: Buffer): void {
    if (WIRE_DEBUG) wireLog(this.remoteAddress, 'recv', chunk);
    if (this.socket.destroyed) return;
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    if (this.proxyPending) {
      if (!this.consumeProxyHeader()) return;
      const cb = this.readyCb;
      this.readyCb = undefined;
      cb?.();
      if (this.socket.destroyed) return;
    }
    while (this.buffer.length >= 2) {
      const length = decodeNumber(this.buffer.subarray(0, 2));
      if (length < MIN_PAYLOAD || length > MAX_PAYLOAD) {
        this.socket.destroy();
        return;
      }
      if (this.buffer.length < 2 + length) return;
      const payload = Uint8Array.from(this.buffer.subarray(2, 2 + length));
      this.buffer = this.buffer.subarray(2 + length);
      this.payloadCb?.(payload);
      if (this.socket.destroyed) return;
    }
  }

  onPayload(cb: (payload: Uint8Array) => void): void {
    this.payloadCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  sendFrame(frame: Uint8Array): void {
    if (WIRE_DEBUG) wireLog(this.remoteAddress, 'send', frame);
    if (this.socket.destroyed || this.ending) return;
    this.socket.write(frame);
    if (this.socket.writableLength > this.maxSendBuffer) {
      log.warn(
        { cat: 'connection', ip: this.remoteAddress, buffered: this.socket.writableLength },
        'send buffer overflow, dropping connection',
      );
      this.socket.destroy();
    }
  }

  end(): void {
    if (this.socket.destroyed || this.ending) return;
    this.ending = true;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), END_TIMEOUT_MS).unref();
  }

  destroy(): void {
    this.socket.destroy();
  }
}

export class WsGameSocket implements GameSocket {
  readonly remoteAddress: string;
  readonly ready = true;
  private readonly socket: WebSocket;
  private readonly maxSendBuffer: number;
  private payloadCb: ((payload: Uint8Array) => void) | undefined;
  private closeCb: (() => void) | undefined;
  private ending = false;

  constructor(
    socket: WebSocket,
    remoteAddress: string | undefined,
    maxSendBuffer = DEFAULT_MAX_SEND_BUFFER,
  ) {
    this.socket = socket;
    this.remoteAddress = remoteAddress ?? 'unknown';
    this.maxSendBuffer = maxSendBuffer;
    socket.on('message', (data, isBinary) => {
      if (!isBinary || !Buffer.isBuffer(data) || data.length < 2 + MIN_PAYLOAD || data.length > MAX_FRAME) {
        socket.terminate();
        return;
      }
      this.payloadCb?.(Uint8Array.from(data.subarray(2)));
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => this.closeCb?.());
  }

  onReady(cb: () => void): void {
    cb();
  }

  onPayload(cb: (payload: Uint8Array) => void): void {
    this.payloadCb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  sendFrame(frame: Uint8Array): void {
    if (this.ending || this.socket.readyState !== this.socket.OPEN) return;
    this.socket.send(frame);
    if (this.socket.bufferedAmount > this.maxSendBuffer) {
      log.warn(
        { cat: 'connection', ip: this.remoteAddress, buffered: this.socket.bufferedAmount },
        'send buffer overflow, dropping connection',
      );
      this.socket.terminate();
    }
  }

  end(): void {
    if (this.ending) return;
    this.ending = true;
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.close(1000);
      setTimeout(() => this.socket.terminate(), END_TIMEOUT_MS).unref();
    } else {
      this.socket.terminate();
    }
  }

  destroy(): void {
    this.socket.terminate();
  }
}
