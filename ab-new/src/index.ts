import 'dotenv/config';
import { DEFAULT_CONFIG, isValidBase58Key, type BotConfig, type TradeMode } from './config.js';
import { ConsoleLogger } from './logger.js';
import { PumpBot } from './bot.js';

const logger = new ConsoleLogger();

const mode: TradeMode = (process.env.AB_MODE as TradeMode) === 'live' ? 'live' : 'paper';

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  mode,
  rpcUrl: process.env.AB_RPC_URL || DEFAULT_CONFIG.rpcUrl,
  privateKey: process.env.AB_PRIVATE_KEY || '',
  snipe: (process.env.AB_SNIPE ?? 'true') === 'true',
  copyWallets: (process.env.AB_COPY_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean),
  buyAmountSol: Number(process.env.AB_BUY_SOL || DEFAULT_CONFIG.buyAmountSol),
  slippagePct: Number(process.env.AB_SLIPPAGE || DEFAULT_CONFIG.slippagePct),
  priorityFeeSol: Number(process.env.AB_PRIORITY_FEE || DEFAULT_CONFIG.priorityFeeSol),
  maxOpenPositions: Number(process.env.AB_MAX_POSITIONS || DEFAULT_CONFIG.maxOpenPositions),
  stopLossPct: Number(process.env.AB_STOP_LOSS || DEFAULT_CONFIG.stopLossPct),
  takeProfitPct: Number(process.env.AB_TAKE_PROFIT || DEFAULT_CONFIG.takeProfitPct),
  holdTimeoutMs: Number(process.env.AB_HOLD_TIMEOUT_MS || DEFAULT_CONFIG.holdTimeoutMs),
  paper: {
    startingSol: Number(process.env.AB_PAPER_SOL || 1),
    feePct: Number(process.env.AB_PAPER_FEE_PCT || 1),
    statsIntervalMs: Number(process.env.AB_PAPER_STATS_MS || 30_000),
  },
};

if (config.mode === 'live' && !isValidBase58Key(config.privateKey)) {
  logger.error('live mode: AB_PRIVATE_KEY missing or invalid (base58 64-byte wallet key required)');
  logger.error('tip: leave AB_MODE unset (or =paper) to run in paper mode without a key');
  process.exit(1);
}

const bot = new PumpBot(config, logger);
bot.start();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    bot.stop();
    process.exit(0);
  });
}
