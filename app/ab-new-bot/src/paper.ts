// AB-new — Paper trading engine.
// Simulates trades against REAL live market prices with realistic fees,
// without spending a single real lamport. Flip AB_MODE=live when ready.

import type { Logger } from './logger.js';

/** pump.fun bonding-curve fee (buy and sell each), plus gas estimate per tx. */
export const CURVE_FEE_PCT = 1.0;
export const EST_GAS_SOL = 0.00005;

export interface PaperPosition {
  mint: string;
  symbol: string;
  entrySol: number;      // SOL spent (fees included)
  tokenAmount: number;   // tokens bought
  entryPriceSol: number; // SOL per token
  entryTime: number;
  why: string;
}

export interface PaperTrade {
  mint: string;
  symbol: string;
  side: 'buy' | 'sell';
  solAmount: number;
  priceSol: number;
  pnlSol: number;         // realized pnl for sells (fees+gas included)
  reason: string;
  time: number;
}

export interface PaperStats {
  startingSol: number;
  equitySol: number;          // cash + open positions at entry value
  realizedPnlSol: number;
  wins: number;
  losses: number;
  openPositions: number;
  totalTrades: number;
  bestTradeSol: number;
  worstTradeSol: number;
}

/** Tracks live prices per mint from real market trades (paper fills use these). */
export class PaperEngine {
  private cashSol: number;
  private readonly initialSol: number;
  private positions = new Map<string, PaperPosition>();
  private trades: PaperTrade[] = [];
  private prices = new Map<string, number>(); // mint -> last price SOL/token
  private wins = 0;
  private losses = 0;
  private realized = 0;
  private best = 0;
  private worst = 0;

  constructor(
    startingSol: number,
    private buyAmountSol: number,
    private feePct: number,
    private log: Logger,
  ) {
    this.cashSol = startingSol;
    this.initialSol = startingSol;
  }

  /** Feed a real market price for a mint (from WS trades or price polling). */
  updatePrice(mint: string, priceSol: number): void {
    if (priceSol > 0) this.prices.set(mint, priceSol);
  }

  priceOf(mint: string): number {
    return this.prices.get(mint) ?? 0;
  }

  canBuy(): boolean {
    return this.cashSol >= this.buyAmountSol + EST_GAS_SOL;
  }

  /** Open a paper position at the current live price. */
  buy(mint: string, symbol: string, why: string): boolean {
    if (!this.canBuy()) {
      this.log.warn('paper: insufficient cash for buy');
      return false;
    }
    const price = this.priceOf(mint);
    if (price <= 0) {
      this.log.warn(`paper: no live price for ${symbol || mint.slice(0, 6)} — skip fill`);
      return false;
    }
    const fee = this.buyAmountSol * this.feePct / 100;
    const netSol = this.buyAmountSol - fee;
    const tokens = netSol / price;
    this.cashSol -= this.buyAmountSol + EST_GAS_SOL;
    this.positions.set(mint, {
      mint, symbol,
      entrySol: this.buyAmountSol,
      tokenAmount: tokens,
      entryPriceSol: price,
      entryTime: Date.now(),
      why,
    });
    this.trades.push({ mint, symbol, side: 'buy', solAmount: this.buyAmountSol, priceSol: price, pnlSol: 0, reason: why, time: Date.now() });
    this.log.success(`paper BUY ${symbol || mint.slice(0, 6)} — ${(tokens / 1e6).toFixed(1)}M tok @ ${price.toExponential(3)} SOL — ${why}`);
    return true;
  }

  /** Close a paper position at the current live price. Returns realized pnl. */
  sell(mint: string, reason: string): number | null {
    const pos = this.positions.get(mint);
    if (!pos) return null;
    const price = this.priceOf(mint) || pos.entryPriceSol;
    const grossSol = pos.tokenAmount * price;
    const fee = grossSol * this.feePct / 100;
    const netSol = grossSol - fee - EST_GAS_SOL;
    const pnl = netSol - pos.entrySol;
    this.cashSol += netSol;
    this.realized += pnl;
    if (pnl >= 0) this.wins++; else this.losses++;
    if (pnl > this.best) this.best = pnl;
    if (pnl < this.worst) this.worst = pnl;
    this.positions.delete(mint);
    this.trades.push({ mint, symbol: pos.symbol, side: 'sell', solAmount: netSol, priceSol: price, pnlSol: pnl, reason, time: Date.now() });
    const pct = (pnl / pos.entrySol * 100).toFixed(2);
    this.log.success(`paper SELL ${pos.symbol || mint.slice(0, 6)} — ${reason} — PnL ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} SOL (${pct}%)`);
    return pnl;
  }

  /** Unrealized pnl % of an open position at current price. */
  pnlPct(mint: string): number {
    const pos = this.positions.get(mint);
    if (!pos) return 0;
    const price = this.priceOf(mint) || pos.entryPriceSol;
    const gross = pos.tokenAmount * price;
    const net = gross * (1 - this.feePct / 100) - EST_GAS_SOL;
    return (net - pos.entrySol) / pos.entrySol * 100;
  }

  position(mint: string): PaperPosition | undefined {
    return this.positions.get(mint);
  }

  allPositions(): PaperPosition[] {
    return [...this.positions.values()];
  }

  recentTrades(n = 10): PaperTrade[] {
    return this.trades.slice(-n).reverse();
  }

  stats(): PaperStats {
    const start = this.initialSol;
    let equity = this.cashSol;
    for (const pos of this.positions.values()) {
      const price = this.priceOf(pos.mint) || pos.entryPriceSol;
      equity += pos.tokenAmount * price * (1 - this.feePct / 100);
    }
    return {
      startingSol: start,
      equitySol: equity,
      realizedPnlSol: this.realized,
      wins: this.wins,
      losses: this.losses,
      openPositions: this.positions.size,
      totalTrades: this.trades.length,
      bestTradeSol: this.best,
      worstTradeSol: this.worst,
    };
  }

  /** Human-readable session summary. */
  summary(): string {
    const s = this.stats();
    const total = s.wins + s.losses;
    const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0.0';
    return [
      '=== PAPER SESSION ===',
      `equity: ${s.equitySol.toFixed(4)} SOL (start ${s.startingSol.toFixed(2)})`,
      `realized PnL: ${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)} SOL`,
      `closed: ${total} (win ${s.wins} / loss ${s.losses} — ${winRate}% win rate)`,
      `open: ${s.openPositions} | trades: ${s.totalTrades}`,
      `best: +${s.bestTradeSol.toFixed(6)} | worst: ${s.worstTradeSol.toFixed(6)}`,
    ].join('\n');
  }
}
