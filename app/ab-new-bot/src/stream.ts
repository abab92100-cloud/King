import WebSocket from 'ws';
import { PUMP_PORTAL_WS, type AccountTradeEvent, type NewTokenEvent } from './config.js';
import type { Logger } from './logger.js';

export interface StreamHandlers {
  onNewToken?: (t: NewTokenEvent) => void;
  onAccountTrade?: (e: AccountTradeEvent) => void;
  onStatus?: (connected: boolean) => void;
}

/**
 * PumpPortal real-time data stream.
 * Methods: subscribeNewToken, subscribeAccountTrade, unsubscribeAccountTrade.
 * Auto-reconnect with backoff, heartbeat ping every 20s (pattern from
 * ahk780 websocket service, hardened like KING's ws reconnect logic).
 */
export class PumpStream {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempts = 0;
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(private apiKey: string | undefined, private h: StreamHandlers, private log: Logger) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private url(): string {
    return this.apiKey ? `${PUMP_PORTAL_WS}?api-key=${this.apiKey}` : PUMP_PORTAL_WS;
  }

  private connect(): void {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.url());
    } catch (e) {
      this.log.error('ws create failed', String(e));
      return this.scheduleReconnect();
    }
    this.ws.on('open', () => {
      this.attempts = 0;
      this.h.onStatus?.(true);
      this.send({ method: 'subscribeNewToken' });
      const wallets = this.copyWalletsSnapshot;
      if (wallets.length > 0) this.send({ method: 'subscribeAccountTrade', keys: wallets });
      this.pingTimer = setInterval(() => this.ws?.ping(), 20_000);
    });
    this.ws.on('message', (raw: string) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.method === 'newToken' || (msg.txType === 'create')) {
          this.h.onNewToken?.(normalizeNewToken(msg));
        } else if (msg.method === 'accountTrade' || msg.solAmount != null) {
          this.h.onAccountTrade?.(normalizeAccountTrade(msg));
        }
      } catch {
        // ignore malformed frame
      }
    });
    this.ws.on('error', (e) => this.log.warn('ws error', String(e)));
    this.ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.h.onStatus?.(false);
      this.scheduleReconnect();
    });
  }

  /** set by the bot each time copy-wallet config changes */
  copyWalletsSnapshot: string[] = [];

  subscribeAccounts(wallets: string[]): void {
    if (this.unsub(wallets)) this.unsub(this.copyWalletsSnapshot);
    this.copyWalletsSnapshot = wallets;
    this.send({ method: 'subscribeAccountTrade', keys: wallets });
  }

  private unsub(wallets: string[]): boolean {
    if (wallets.length > 0) this.send({ method: 'unsubscribeAccountTrade', keys: wallets });
    return wallets.length > 0;
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.attempts++);
    setTimeout(() => this.connect(), delay);
  }

  stop(): void {
    this.stopped = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = null;
  }
}

export function normalizeNewToken(msg: any): NewTokenEvent {
  return {
    mint: msg.mint ?? msg.tokenAddress ?? '',
    name: msg.name ?? '',
    symbol: msg.symbol ?? '',
    uri: msg.uri ?? '',
    bondingCurveKey: msg.bondingCurveKey ?? '',
    associatedBondingCurve: msg.associatedBondingCurve ?? '',
    user: msg.user ?? msg.creator ?? '',
    timestamp: msg.timestamp ?? Date.now(),
    initialLiquidity: msg.initialLiquidity != null ? Number(msg.initialLiquidity) : undefined,
  };
}

export function normalizeAccountTrade(msg: any): AccountTradeEvent {
  return {
    account: msg.account ?? msg.traderPublicKey ?? '',
    mint: msg.mint ?? msg.tokenAddress ?? '',
    tokenAmount: Number(msg.tokenAmount ?? 0),
    solAmount: Number(msg.solAmount ?? 0),
    buy: msg.buy === true,
    signature: msg.signature ?? '',
    timestamp: msg.timestamp ?? Date.now(),
  };
}
