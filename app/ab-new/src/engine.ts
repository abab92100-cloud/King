// AB-new — Pump.fun paper/live trading engine for the mobile app.
// Ports the terminal bot (paper.ts) into a UI-subscribable store.

export type Mode = 'paper' | 'live';

export interface PaperPos {
  mint: string; symbol: string; entrySol: number; tokenAmount: number;
  entryPriceSol: number; entryTime: number; why: string; pnlPct: number;
}
export interface TradeRec {
  mint: string; symbol: string; side: 'buy' | 'sell'; solAmount: number;
  priceSol: number; pnlSol: number; reason: string; time: number;
}
export interface Stats {
  equitySol: number; realizedPnlSol: number; wins: number; losses: number;
  openPositions: number; totalTrades: number; bestTradeSol: number; worstTradeSol: number;
}
export interface LogLine { t: number; level: 'info' | 'warn' | 'error' | 'success'; msg: string; }

const LS = {
  cfg: 'abnew_cfg_v1',
};

export interface Cfg {
  mode: Mode;
  startingSol: number;
  buyAmountSol: number;
  slippagePct: number;
  stopLossPct: number;
  takeProfitPct: number;
  holdTimeoutMs: number;
  maxOpenPositions: number;
  feePct: number;
  snipe: boolean;
  copyWallets: string;
  blockNames: string;
}

export const DEFAULT_CFG: Cfg = {
  mode: 'paper',
  startingSol: 1,
  buyAmountSol: 0.01,
  slippagePct: 10,
  stopLossPct: 30,
  takeProfitPct: 50,
  holdTimeoutMs: 10 * 60_000,
  maxOpenPositions: 3,
  feePct: 1,
  snipe: true,
  copyWallets: '',
  blockNames: 'PEPE',
};

export function loadCfg(): Cfg {
  try {
    const raw = localStorage.getItem(LS.cfg);
    if (raw) return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch { /* fresh install */ }
  return { ...DEFAULT_CFG };
}
export function persistCfg(c: Cfg) {
  try { localStorage.setItem(LS.cfg, JSON.stringify(c)); } catch { /* private mode */ }
}

const CURVE_FEE_PCT = 1.0;
const EST_GAS_SOL = 0.00005;

/* ─────────── the engine state (module singleton) ─────────── */
export const S = {
  running: false,
  cfg: loadCfg(),
  cashSol: 1,
  positions: new Map<string, PaperPos>(),
  prices: new Map<string, number>(),
  trades: [] as TradeRec[],
  logs: [] as LogLine[],
  wins: 0, losses: 0, realized: 0, best: 0, worst: 0,
  wsConnected: false,
  streamStartedAt: 0,
  tokensSeen: 0,
};

const subs = new Set<() => void>();
export function subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); }
function emit() { for (const f of subs) f(); }

export function log(level: LogLine['level'], msg: string) {
  S.logs.unshift({ t: Date.now(), level, msg });
  if (S.logs.length > 400) S.logs.length = 400;
  notify(level, msg);
  emit();
}

/* ─────────── notifications ─────────────────── */
async function notify(level: string, msg: string) {
  try {
    const Cap = (window as any).Capacitor;
    if (!Cap?.isNativePlatform?.()) return;
    const { LocalNotifications } = Cap.Plugins;
    await LocalNotifications?.schedule({
      notifications: [{
        title: level === 'success' ? '✅ AB-new' : level === 'error' ? '⚠️ AB-new' : 'AB-new',
        body: msg.slice(0, 120),
        id: Date.now() % 2147483647,
      }],
    });
  } catch { /* notifications not granted — silent */ }
}

/* ─────────── paper engine core ─────────────────── */
function canBuy(): boolean {
  return S.cashSol >= S.cfg.buyAmountSol + EST_GAS_SOL;
}

function priceOf(mint: string): number { return S.prices.get(mint) ?? 0; }

export function buyPaper(mint: string, symbol: string, why: string): boolean {
  if (!canBuy()) { log('warn', 'رصيد ورقي غير كافٍ للشراء'); return false; }
  const price = priceOf(mint);
  if (price <= 0) { log('warn', `لا يوجد سعر حي لـ ${symbol || mint.slice(0, 6)} — تخطي`); return false; }
  if (S.positions.size >= S.cfg.maxOpenPositions) { log('warn', 'الحد الأقصى للمراكز المفتوحة'); return false; }
  const fee = S.cfg.buyAmountSol * CURVE_FEE_PCT / 100;
  const net = S.cfg.buyAmountSol - fee;
  const tokens = net / price;
  S.cashSol -= S.cfg.buyAmountSol + EST_GAS_SOL;
  S.positions.set(mint, {
    mint, symbol, entrySol: S.cfg.buyAmountSol, tokenAmount: tokens,
    entryPriceSol: price, entryTime: Date.now(), why, pnlPct: 0,
  });
  S.trades.unshift({ mint, symbol, side: 'buy', solAmount: S.cfg.buyAmountSol, priceSol: price, pnlSol: 0, reason: why, time: Date.now() });
  if (S.trades.length > 200) S.trades.length = 200;
  log('success', `🟢 شراء ورقي ${symbol || mint.slice(0, 6)} — ${(tokens / 1e6).toFixed(1)}M توكن`);
  return true;
}

export function sellPaper(mint: string, reason: string): number | null {
  const pos = S.positions.get(mint);
  if (!pos) return null;
  const price = priceOf(mint) || pos.entryPriceSol;
  const gross = pos.tokenAmount * price;
  const fee = gross * CURVE_FEE_PCT / 100;
  const net = gross - fee - EST_GAS_SOL;
  const pnl = net - pos.entrySol;
  S.cashSol += net;
  S.realized += pnl;
  if (pnl >= 0) S.wins++; else S.losses++;
  if (pnl > S.best) S.best = pnl;
  if (pnl < S.worst) S.worst = pnl;
  S.positions.delete(mint);
  S.trades.unshift({ mint, symbol: pos.symbol, side: 'sell', solAmount: net, priceSol: price, pnlSol: pnl, reason, time: Date.now() });
  const pct = (pnl / pos.entrySol * 100).toFixed(1);
  log(pnl >= 0 ? 'success' : 'warn', `🔴 بيع ورقي ${pos.symbol || mint.slice(0, 6)} — ${reason} — ${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} SOL (${pct}%)`);
  return pnl;
}

export function pnlPct(mint: string): number {
  const pos = S.positions.get(mint);
  if (!pos) return 0;
  const price = priceOf(mint) || pos.entryPriceSol;
  const net = pos.tokenAmount * price * (1 - CURVE_FEE_PCT / 100) - EST_GAS_SOL;
  return (net - pos.entrySol) / pos.entrySol * 100;
}

export function stats(): Stats {
  let equity = S.cashSol;
  for (const p of S.positions.values()) {
    const price = priceOf(p.mint) || p.entryPriceSol;
    equity += p.tokenAmount * price * (1 - CURVE_FEE_PCT / 100);
  }
  return {
    equitySol: equity, realizedPnlSol: S.realized, wins: S.wins, losses: S.losses,
    openPositions: S.positions.size, totalTrades: S.trades.length,
    bestTradeSol: S.best, worstTradeSol: S.worst,
  };
}

/* ─────────── strategy ─────────── */
function shouldSnipe(mint: string, name: string, symbol: string, ts: number): { ok: boolean; why: string } {
  const c = S.cfg;
  if (ts && Date.now() - ts > 3_000 && Date.now() - ts < 0) return { ok: false, why: 'قديم' };
  for (const blk of c.blockNames.split(',').map(s => s.trim()).filter(Boolean)) {
    try {
      if (new RegExp(blk, 'i').test(name) || new RegExp(blk, 'i').test(symbol)) {
        return { ok: false, why: `اسم محجوب (${blk})` };
      }
    } catch { /* bad regex in config — ignore */ }
  }
  return { ok: true, why: 'توكن جديد اجتاز الفلاتر' };
}

function exitReason(pos: PaperPos): string | null {
  const c = S.cfg;
  const pnl = pnlPct(pos.mint);
  if (pnl >= c.takeProfitPct) return `جني أرباح ${pnl.toFixed(1)}%`;
  if (pnl <= -c.stopLossPct) return `وقف خسارة ${pnl.toFixed(1)}%`;
  if (Date.now() - pos.entryTime >= c.holdTimeoutMs) return 'مهلة الحمل انتهت';
  return null;
}

/* ─────────── live stream (PumpPortal WS) ─────────── */
let ws: WebSocket | null = null;
let monitor: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;

export function startBot() {
  if (S.running) return;
  S.running = true;
  S.streamStartedAt = Date.now();
  S.cashSol = S.cfg.startingSol;
  S.positions.clear(); S.prices.clear();
  S.trades.length = 0; S.logs.length = 0;
  S.wins = S.losses = S.realized = S.best = S.worst = 0;
  connectWs();
  monitor = setInterval(() => {
    for (const pos of [...S.positions.values()]) {
      const why = exitReason(pos);
      if (why) sellPaper(pos.mint, why);
    }
    // refresh unrealized pnl on positions
    for (const p of S.positions.values()) p.pnlPct = pnlPct(p.mint);
    emit();
  }, 5_000);
  statsTimer = setInterval(() => {
    const s = stats();
    log('info', `📊 الرصيد ${s.equitySol.toFixed(4)} SOL | الربح المحقق ${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)} | مفتوح ${s.openPositions}`);
  }, 30_000);
  acquireKeepAwake();
  log('success', `بدأ البوت [${S.cfg.mode === 'paper' ? 'ورقي 📝' : 'حقيقي ⚡'}] — رصيد ${S.cfg.startingSol} SOL`);
  emit();
}

export function stopBot() {
  if (!S.running) return;
  S.running = false;
  try { ws?.close(); } catch { /* already closed */ }
  ws = null;
  if (monitor) clearInterval(monitor);
  if (statsTimer) clearInterval(statsTimer);
  monitor = statsTimer = null;
  S.wsConnected = false;
  releaseKeepAwake();
  log('info', summary());
  emit();
}

function connectWs() {
  try {
    ws = new WebSocket('wss://pumpportal.fun/api/data');
  } catch (e) {
    log('error', 'فشل الاتصال بالبث: ' + String(e));
    return;
  }
  ws.onopen = () => {
    S.wsConnected = true;
    ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
    const wallets = S.cfg.copyWallets.split(',').map(s => s.trim()).filter(Boolean);
    if (wallets.length) ws?.send(JSON.stringify({ method: 'subscribeAccountTrade', keys: wallets }));
    log('success', 'اتصال البث المباشر ✓ (يراقب كل توكن جديد)');
    emit();
  };
  ws.onmessage = ev => {
    try {
      const m = JSON.parse(String(ev.data));
      if (m.method === 'newToken' || m.tokenAmount != null || m.solAmount != null) {
        handleEvent(m);
      }
    } catch { /* malformed frame */ }
  };
  ws.onerror = () => { log('warn', 'خطأ بالبث — سيُعاد الاتصال'); };
  ws.onclose = () => {
    S.wsConnected = false;
    emit();
    if (S.running) setTimeout(connectWs, Math.min(15_000, 2_000 + Math.random() * 3_000));
  };
}

function handleEvent(m: any) {
  // price feed from every market trade
  if (m.mint && Number(m.solAmount) > 0 && Number(m.tokenAmount) > 0) {
    S.prices.set(m.mint, Number(m.solAmount) / Number(m.tokenAmount));
  }
  if (m.method === 'newToken' && m.mint) {
    S.tokensSeen++;
    S.prices.set(m.mint, 0.00000005); // placeholder opening price
    if (!S.cfg.snipe || !S.running) return;
    const decision = shouldSnipe(m.mint, m.name ?? '', m.symbol ?? '', 0);
    if (decision.ok) buyPaper(m.mint, m.symbol || m.name || m.mint.slice(0, 6), 'snipe: ' + decision.why);
    else log('warn', `تخطي ${m.symbol || m.mint.slice(0, 6)}: ${decision.why}`);
    emit();
  }
}

export function summary(): string {
  const s = stats();
  const total = s.wins + s.losses;
  const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0';
  return `الجلسة: الرصيد ${s.equitySol.toFixed(4)} SOL | الربح ${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)} | صفقات ${total} (${winRate}% نجاح)`;
}

/* ─────────── keep-awake (background operation) ─────────────────── */
async function acquireKeepAwake() {
  try {
    const Cap = (window as any).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const KN = Cap.Plugins?.KingNative;
      await KN?.acquireWakeLock?.();
    }
  } catch { /* web preview */ }
}
async function releaseKeepAwake() {
  try {
    const Cap = (window as any).Capacitor;
    if (Cap?.isNativePlatform?.()) {
      const KN = Cap.Plugins?.KingNative;
      await KN?.releaseWakeLock?.();
    }
  } catch { /* web preview */ }
}

export function fmtSol(v: number): string {
  return v.toFixed(4);
}
export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
