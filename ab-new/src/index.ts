import 'dotenv/config';
import { DEFAULT_CONFIG, type BotConfig } from './config.js';
import { ConsoleLogger } from './logger.js';
import { PumpBot } from './bot.js';
import { isValidBase58Key } from './config.js';

const logger = new ConsoleLogger();

const config: BotConfig = {
  ...DEFAULT_CONFIG,
  rpcUrl: process.env.AB_RPC_URL || DEFAULT_CONFIG.rpcUrl,
  privateKey: process.env.AB_PRIVATE_KEY || '',
  snipe: (process.env.AB_SNIPE ?? 'true') === 'true',
  copyWallets: (process.env.AB_COPY_WALLETS || '').split(',').map(s => s.trim()).filter(Boolean),
  buyAmountSol: Number(process.env.AB_BUY_SOL || DEFAULT_CONFIG.buyAmountSol),
  slippagePct: Number(process.env.AB_SLIPPAGE || DEFAULT_CONFIG.slippagePct),
  priorityFeeSol: Number(process.env.AB_PRIORITY_FEE || DEFAULT_CONFIG.priorityFeeSol),
};

if (!isValidBase58Key(config.privateKey)) {
  logger.error('AB_PRIVATE_KEY missing or invalid (base58 64-byte wallet key required)');
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
