import type { AccountTradeEvent, BotConfig, NewTokenEvent, Position } from './config.js';
import { exitReason, shouldSnipe } from './strategy.js';
import { PumpStream } from './stream.js';
import { TradeExecutor } from './executor.js';
import { PaperEngine } from './paper.js';
import type { Logger } from './logger.js';

export class PumpBot {
  private stream: PumpStream;
  private executor: TradeExecutor | null = null;
  private paper: PaperEngine | null = null;
  private positions = new Map<string, Position>();     // live positions
  private seen = new Set<string>();
  private monitorTimer: NodeJS.Timeout | null = null;
  private statsTimer: NodeJS.Timeout | null = null;

  constructor(private config: BotConfig, private log: Logger) {
    if (this.config.mode === 'live') {
      this.executor = new TradeExecutor(config, log);
    } else {
      this.paper = new PaperEngine(
        config.paper.startingSol,
        config.buyAmountSol,
        config.paper.feePct,
        log,
      );
    }
    this.stream = new PumpStream(undefined, {
      onNewToken: t => this.handleNewToken(t),
      onAccountTrade: e => this.handleAccountTrade(e),
      onStatus: ok => this.log.info(ok ? 'stream connected' : 'stream disconnected'),
    }, log);
  }

  start(): void {
    if (this.config.mode === 'live' && !this.config.privateKey) {
      throw new Error('live mode requires AB_PRIVATE_KEY');
    }
    this.stream.copyWalletsSnapshot = this.config.copyWallets;
    this.stream.start();
    this.monitorTimer = setInterval(() => void this.monitorPositions(), 5_000);
    this.statsTimer = setInterval(() => this.printStats(), this.config.mode === 'paper'
      ? this.config.paper.statsIntervalMs
      : 60_000);
    this.log.success(`AB-new bot started [${this.config.mode.toUpperCase()}]`, {
      snipe: this.config.snipe,
      copyWallets: this.config.copyWallets.length,
      buyAmountSol: this.config.buyAmountSol,
      ...(this.config.mode === 'paper' ? { paperSol: this.config.paper.startingSol } : {}),
    });
  }

  stop(): void {
    this.stream.stop();
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.paper) this.log.info('\n' + this.paper.summary());
    this.log.info('bot stopped');
  }

  private async handleNewToken(t: NewTokenEvent): Promise<void> {
    if (!this.config.snipe || !t.mint) return;
    // paper mode: track the new mint's price from the very first trade
    this.paper?.updatePrice(t.mint, this.estimateInitialPrice(t));
    const decision = shouldSnipe(t, this.config);
    if (!decision.buy) {
      this.log.warn(`skip ${t.symbol || t.mint.slice(0, 6)}: ${decision.reason}`);
      return;
    }
    await this.openPosition(t.mint, t.symbol || t.mint, `snipe: ${decision.reason}`);
  }

  private async handleAccountTrade(e: AccountTradeEvent): Promise<void> {
    // feed real prices into the paper engine on every market trade
    if (e.mint && e.solAmount > 0 && e.tokenAmount > 0) {
      this.paper?.updatePrice(e.mint, e.solAmount / e.tokenAmount);
    }
    if (!this.config.copyWallets.includes(e.account) || !e.buy || !e.mint) return;
    const dedupeKey = `${e.account}:${e.mint}:${e.signature}`;
    if (this.seen.has(dedupeKey)) return;
    this.seen.add(dedupeKey);
    await this.openPosition(e.mint, e.mint, `copy ${e.account.slice(0, 6)} (${e.solAmount} SOL)`);
  }

  /** Rough opening price for a fresh coin: creator buys ~0.02-0.05 SOL at launch. */
  private estimateInitialPrice(_t: NewTokenEvent): number {
    // pump.fun curves start at ~$4-5k mcap with 1B supply.
    // We start with a conservative placeholder and let real trade prints refine it.
    return 0.00000005;
  }

  private async openPosition(mint: string, label: string, why: string): Promise<void> {
    if (this.config.mode === 'paper') {
      if ((this.paper?.allPositions().length ?? 0) >= this.config.maxOpenPositions) {
        this.log.warn(`paper: max positions reached — skip ${label}`);
        return;
      }
      this.paper?.buy(mint, label, why);
      return;
    }
    // live path
    if (this.positions.size >= this.config.maxOpenPositions) {
      this.log.warn(`max positions reached — skip ${label}`);
      return;
    }
    try {
      const r = await this.executor!.trade('buy', mint, this.config.buyAmountSol, true);
      if (!r.confirmed) throw new Error(r.error ?? 'not confirmed');
      const pos: Position = {
        mint,
        entrySol: this.config.buyAmountSol,
        tokenAmount: 0,
        entryTime: Date.now(),
        signature: r.signature,
      };
      pos.tokenAmount = await this.executor!.tokenBalance(mint);
      this.positions.set(mint, pos);
      this.log.success(`BUY ${label} — ${why} — https://solscan.io/tx/${r.signature}`);
    } catch (e) {
      this.log.error(`buy failed ${label}`, String(e));
    }
  }

  private async monitorPositions(): Promise<void> {
    if (this.config.mode === 'paper') {
      for (const pos of this.paper!.allPositions()) {
        const pnl = this.paper!.pnlPct(pos.mint);
        const why = exitReason(
          { mint: pos.mint, entrySol: pos.entrySol, tokenAmount: pos.tokenAmount, entryTime: pos.entryTime, signature: 'paper' },
          pnl,
          this.config,
        );
        if (why) this.paper!.sell(pos.mint, why);
        else if (Math.random() < 0.2) {
          // occasional live pnl log line for open paper positions
          this.log.info(`paper hold ${pos.symbol || pos.mint.slice(0, 6)} — ${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`);
        }
      }
      return;
    }
    for (const [mint, pos] of [...this.positions]) {
      try {
        const bal = await this.executor!.tokenBalance(mint);
        if (bal <= 0) { this.positions.delete(mint); continue; }
        const why = exitReason(pos, 0, this.config);
        if (why) await this.closePosition(mint, why);
      } catch (e) {
        this.log.warn(`monitor error ${mint}`, String(e));
      }
    }
  }

  async closePosition(mint: string, why: string): Promise<void> {
    if (this.config.mode === 'paper') {
      this.paper?.sell(mint, why);
      return;
    }
    const pos = this.positions.get(mint);
    if (!pos) return;
    const bal = await this.executor!.tokenBalance(mint);
    if (bal <= 0) { this.positions.delete(mint); return; }
    const r = await this.executor!.trade('sell', mint, 100, false);
    if (r.confirmed) {
      this.positions.delete(mint);
      this.log.success(`SELL ${mint} — ${why} — https://solscan.io/tx/${r.signature}`);
    } else {
      this.log.error(`sell failed ${mint}: ${r.error}`);
    }
  }

  private printStats(): void {
    if (this.config.mode === 'paper') {
      const s = this.paper!.stats();
      const total = s.wins + s.losses;
      const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '—';
      this.log.info(
        `📊 paper — equity ${s.equitySol.toFixed(4)} SOL | PnL ${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)} | ` +
        `closed ${total} (${winRate}% win) | open ${s.openPositions}`
      );
    } else {
      this.log.info(`📊 live — open positions: ${this.positions.size}`);
    }
  }

  get openPositions(): Position[] {
    if (this.config.mode === 'paper') {
      return this.paper!.allPositions().map(p => ({
        mint: p.mint, entrySol: p.entrySol, tokenAmount: p.tokenAmount,
        entryTime: p.entryTime, signature: 'paper',
      }));
    }
    return [...this.positions.values()];
  }
}
