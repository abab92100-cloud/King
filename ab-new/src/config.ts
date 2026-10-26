// AB-new — Pump.fun sniper & copy-trading bot.
// Trade path: PumpPortal Local Transaction API (builds the tx) -> we sign locally -> send via our RPC.
// Data path: PumpPortal WebSocket (subscribeNewToken / subscribeAccountTrade).
// Program constants verified against chainstacklabs/pump-fun-bot and 1fge/pump-fun-sniper-bot.

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_GLOBAL = '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsixWn4gdSCHNFLaSpA4dP1o';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export const PUMP_PORTAL_TRADE_LOCAL = 'https://pumpportal.fun/api/trade-local';
export const PUMP_PORTAL_WS = 'wss://pumpportal.fun/api/data';

export type TradeMode = 'paper' | 'live';

export interface PaperConfig {
  startingSol: number;
  feePct: number;
  statsIntervalMs: number;
}

export interface BotConfig {
  rpcUrl: string;
  /** base58 64-byte private key of the trading wallet */
  privateKey: string;
  /** paper (default): simulate against live prices — no real funds. live: real trades. */
  mode: TradeMode;
  paper: PaperConfig;
  /** sniper: buy new tokens matching filters */
  snipe: boolean;
  /** copy-trade: mirror these wallets' buys */
  copyWallets: string[];
  buyAmountSol: number;
  slippagePct: number;
  priorityFeeSol: number;
  pool: 'auto' | 'pumpfun' | 'raydium' | 'pumpswap';
  maxOpenPositions: number;
  stopLossPct: number;
  takeProfitPct: number;
  holdTimeoutMs: number;
  filters: {
    maxTokenAgeMs: number;
    minInitialLiquiditySol: number;
    blockNames: RegExp[];
  };
}

export const DEFAULT_CONFIG: BotConfig = {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  privateKey: '',
  mode: 'paper',
  paper: { startingSol: 1, feePct: 1, statsIntervalMs: 30_000 },
  snipe: true,
  copyWallets: [],
  buyAmountSol: 0.01,
  slippagePct: 10,
  priorityFeeSol: 0.00005,
  pool: 'auto',
  maxOpenPositions: 3,
  stopLossPct: 30,
  takeProfitPct: 50,
  holdTimeoutMs: 10 * 60_000,
  filters: {
    maxTokenAgeMs: 3_000,
    minInitialLiquiditySol: 0,
    blockNames: [/PEPE/i],
  },
};

export interface NewTokenEvent {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  bondingCurveKey: string;
  associatedBondingCurve: string;
  user: string;
  timestamp: number;
  initialLiquidity?: number;
}

export interface AccountTradeEvent {
  account: string;
  mint: string;
  tokenAmount: number;
  solAmount: number;
  buy: boolean;
  signature: string;
  timestamp: number;
}

export interface Position {
  mint: string;
  entrySol: number;
  tokenAmount: number;
  entryTime: number;
  signature: string;
}

export function isValidBase58Key(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  try {
    // bs58 decode throws on invalid chars; wallet keys are 64 bytes.
    // Lazy import avoidance: implement a strict base58 alphabet check + length
    // after decoding via the bs58 package is done in tests; here a cheap check.
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    for (const ch of key) if (!ALPHABET.includes(ch)) return false;
    return key.length >= 80 && key.length <= 96;
  } catch {
    return false;
  }
}
