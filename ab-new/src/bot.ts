import type { AccountTradeEvent, BotConfig, NewTokenEvent, Position } from './config.js';
import { exitReason, shouldSnipe } from './strategy.js';
import { PumpStream } from './stream.js';
import { TradeExecutor } from './executor.js';
import type { Logger } from './logger.js';

export class PumpBot {
  private stream: PumpStream;
  private executor: TradeExecutor;
  private positions = new Map<string, Position>();
  private seen = new Set<string>();
  private monitorTimer: NodeJS.Timeout | null = null;

  constructor(private config: BotConfig, private log: Logger) {
    this.executor = new TradeExecutor(config, log);
    this.stream = new PumpStream(undefined, {
      onNewToken: t => this.handleNewToken(t),
      onAccountTrade: e => this.handleAccountTrade(e),
      onStatus: ok => this.log.info(ok ? 'stream connected' : 'stream disconnected'),
    }, log);
  }

  start(): void {
    if (!this.config.privateKey) throw new Error('missing private key (AB_PRIVATE_KEY)');
    this.stream.copyWalletsSnapshot = this.config.copyWallets;
    this.stream.start();
    this.monitorTimer = setInterval(() => void this.monitorPositions(), 5_000);
    this.log.success('AB-new bot started', {
      snipe: this.config.snipe,
      copyWallets: this.config.copyWallets.length,
      buyAmountSol: this.config.buyAmountSol,
    });
  }

  stop(): void {
    this.stream.stop();
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.log.info('bot stopped');
  }

  private async handleNewToken(t: NewTokenEvent): Promise<void> {
    if (!this.config.snipe || !t.mint) return;
    const decision = shouldSnipe(t, this.config);
    if (!decision.buy) {
      this.log.warn(`skip ${t.symbol || t.mint.slice(0, 6)}: ${decision.reason}`);
      return;
    }
    await this.openPosition(t.mint, t.symbol || t.mint, `snipe: ${decision.reason}`);
  }

  private async handleAccountTrade(e: AccountTradeEvent): Promise<void> {
    if (!this.config.copyWallets.includes(e.account) || !e.buy || !e.mint) return;
    const dedupeKey = `${e.account}:${e.mint}:${e.signature}`;
    if (this.seen.has(dedupeKey)) return;
    this.seen.add(dedupeKey);
    await this.openPosition(e.mint, e.mint, `copy ${e.account.slice(0, 6)} (${e.solAmount} SOL)`);
  }

  private async openPosition(mint: string, label: string, why: string): Promise<void> {
    if (this.positions.size >= this.config.maxOpenPositions) {
      this.log.warn(`max positions reached — skip ${label}`);
      return;
    }
    try {
      const r = await this.executor.trade('buy', mint, this.config.buyAmountSol, true);
      if (!r.confirmed) throw new Error(r.error ?? 'not confirmed');
      const pos: Position = {
        mint,
        entrySol: this.config.buyAmountSol,
        tokenAmount: 0,
        entryTime: Date.now(),
        signature: r.signature,
      };
      pos.tokenAmount = await this.executor.tokenBalance(mint);
      this.positions.set(mint, pos);
      this.log.success(`BUY ${label} — ${why} — https://solscan.io/tx/${r.signature}`);
    } catch (e) {
      this.log.error(`buy failed ${label}`, String(e));
    }
  }

  private async monitorPositions(): Promise<void> {
    for (const [mint, pos] of [...this.positions]) {
      try {
        const bal = await this.executor.tokenBalance(mint);
        if (bal <= 0) { this.positions.delete(mint); continue; }
        // time-based exit only (price feed left pluggable)
        const why = exitReason(pos, 0, this.config);
        if (why) await this.closePosition(mint, why);
      } catch (e) {
        this.log.warn(`monitor error ${mint}`, String(e));
      }
    }
  }

  async closePosition(mint: string, why: string): Promise<void> {
    const pos = this.positions.get(mint);
    if (!pos) return;
    const bal = await this.executor.tokenBalance(mint);
    if (bal <= 0) { this.positions.delete(mint); return; }
    const r = await this.executor.trade('sell', mint, 100, false);
    if (r.confirmed) {
      this.positions.delete(mint);
      this.log.success(`SELL ${mint} — ${why} — https://solscan.io/tx/${r.signature}`);
    } else {
      this.log.error(`sell failed ${mint}: ${r.error}`);
    }
  }

  get openPositions(): Position[] {
    return [...this.positions.values()];
  }
}
