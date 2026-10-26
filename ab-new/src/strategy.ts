import type { BotConfig, NewTokenEvent, Position } from './config.js';

export interface StrategyDecision {
  buy: boolean;
  reason: string;
}

/** Token-creation filter: decide whether a fresh pump.fun coin is worth sniping. */
export function shouldSnipe(token: NewTokenEvent, config: BotConfig): StrategyDecision {
  const now = Date.now();
  const ts = typeof token.timestamp === 'number' && token.timestamp > 1e12
    ? token.timestamp
    : (token.timestamp ?? 0) * 1000;
  if (ts && now - ts > config.filters.maxTokenAgeMs) {
    return { buy: false, reason: `token too old (${Math.round((now - ts) / 1000)}s)` };
  }
  for (const re of config.filters.blockNames) {
    if (re.test(token.name) || re.test(token.symbol)) {
      return { buy: false, reason: `name blocked by filter ${re}` };
    }
  }
  if (config.filters.minInitialLiquiditySol > 0) {
    const liq = token.initialLiquidity ?? 0;
    if (liq < config.filters.minInitialLiquiditySol) {
      return { buy: false, reason: `initial liquidity ${liq} < ${config.filters.minInitialLiquiditySol}` };
    }
  }
  return { buy: true, reason: 'fresh token passed filters' };
}

/** Position-exit decision: take profit, stop loss, or time-based exit. */
export function exitReason(position: Position, currentPnlPct: number, config: BotConfig): string | null {
  if (currentPnlPct >= config.takeProfitPct) return `take-profit ${currentPnlPct.toFixed(1)}%`;
  if (currentPnlPct <= -config.stopLossPct) return `stop-loss ${currentPnlPct.toFixed(1)}%`;
  if (Date.now() - position.entryTime >= config.holdTimeoutMs) return 'hold timeout';
  return null;
}

/** Slippage-aware buy sizing: never exceed configured SOL budget. */
export function sizeBuy(budgetSol: number, priceSolPerToken: number, slippagePct: number): { tokens: number; maxCostSol: number } {
  if (priceSolPerToken <= 0) return { tokens: 0, maxCostSol: 0 };
  const tokens = budgetSol / priceSolPerToken;
  const maxCostSol = budgetSol * (1 + slippagePct / 100);
  return { tokens, maxCostSol };
}

/** PnL% given entry SOL size and current value in SOL. */
export function pnlPct(entrySol: number, currentSol: number): number {
  if (entrySol <= 0) return 0;
  return ((currentSol - entrySol) / entrySol) * 100;
}
