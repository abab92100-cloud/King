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
  minBuySignals: number;      // عدد صفقات شراء مؤكدة قبل الدخول
  minPumpPct: number;         // ارتفاع السعر الأدنى من أول سعر
  maxTokenAgeSec: number;     // تجاهل التوكنات الأقدم من هذا
  trailStopPct: number;       // وقف متحرك: ينزل من القمة
  relayUrl: string;           // سيرفر مثبّت اختياري (ws://ip:port) — بث دائم بلا انقطاع
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
  minBuySignals: 4,     // 4 مشترين قبل الدخول
  minPumpPct: 15,       // ارتفاع 25%+ من سعر الافتتاح
  maxTokenAgeSec: 45,   // توكنات أحدث من 30 ثانية فقط
  trailStopPct: 15,    // اقفل إذا هبط 15% من القمة
  relayUrl: '',        // فارغ = اتصال مباشر، أو ws://عنوان:منفذ
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
  /** توكنات مرشحة قيد الرصد: نجمع زخمها قبل الدخول */
  candidates: new Map<string, { symbol: string; openPrice: number; lastPrice: number; buys: number; sells: number; firstSeen: number }>(),
  /** قمة سعر كل مركز مفتوح — للوقف المتحرك */
  peaks: new Map<string, number>(),
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
  S.peaks.set(mint, price);
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
  S.peaks.delete(mint);
  unsubscribeMintTrades(mint);
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

  // الوقف المتحرك: إذا صنعنا ربحًا ثم هبطنا من القمة — نحفظ المكسب
  const peak = S.peaks.get(pos.mint);
  const cur = priceOf(pos.mint);
  if (peak && cur > 0) {
    const fromPeakPct = (1 - cur / peak) * 100;
    const gainedPct = (peak / pos.entryPriceSol - 1) * 100;
    // لا يتفعّل إلا بعد ربح 10%+ ثم هبوط من القمة بنسبة الوقف المتحرك
    if (gainedPct >= 10 && fromPeakPct >= c.trailStopPct) {
      return `وقف متحرك ${pnl.toFixed(1)}% (هبط ${fromPeakPct.toFixed(0)}% من القمة)`;
    }
  }

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
  }, 2_000);
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
    const url = S.cfg.relayUrl?.trim() || 'wss://pumpportal.fun/api/data';
    ws = new WebSocket(url);
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
    if (S.running) setTimeout(connectWs, 1_000 + Math.random() * 2_000);
  };
}

function handleEvent(m: any) {
  if (!m?.mint) return;
  const price = (Number(m.solAmount) > 0 && Number(m.tokenAmount) > 0)
    ? Number(m.solAmount) / Number(m.tokenAmount) : 0;

  if (m.method === 'newToken') {
    // توكن جديد: سجّله مرشحًا واشترك بصفقاته فورًا — بدونها لا يصل أي زخم!
    S.tokensSeen++;
    S.candidates.set(m.mint, {
      symbol: m.symbol || m.name || m.mint.slice(0, 6),
      openPrice: price || 0, lastPrice: price || 0,
      buys: 0, sells: 0, firstSeen: Date.now(),
    });
    subscribeMintTrades(m.mint);
    emit();
    return;
  }

  // صفقة سوق حية على توكن نرصده أو نحمله
  if (price > 0) {
    S.prices.set(m.mint, price);

    // حدّث قمة المركز المفتوح (للوقف المتحرك)
    if (S.positions.has(m.mint)) {
      const peak = S.peaks.get(m.mint) ?? price;
      if (price > peak) S.peaks.set(m.mint, price);
    }

    // حدّث المرشح وقرر الدخول عند اكتمال الزخم
    const cand = S.candidates.get(m.mint);
    if (cand) {
      cand.lastPrice = price;
      if (m.isBuy === true || m.buy === true) cand.buys++; else cand.sells++;
      maybeEnter(m.mint, cand);
    }
  }
}

/** الدخول فقط عند اكتمال شروط الزخم — لا شراء أعمى */
function maybeEnter(mint: string, cand: { symbol: string; openPrice: number; lastPrice: number; buys: number; sells: number; firstSeen: number }) {
  if (!S.running || !S.cfg.snipe) return;
  if (S.positions.has(mint)) return; // نحمله بالفعل
  const c = S.cfg;
  const ageSec = (Date.now() - cand.firstSeen) / 1000;

  // تجاهل المرشح إذا فات عمره أو انقلب لبيع كاسح
  if (ageSec > c.maxTokenAgeSec) { S.candidates.delete(mint); unsubscribeMintTrades(mint); return; }

  const pumpPct = cand.openPrice > 0 ? (cand.lastPrice / cand.openPrice - 1) * 100 : 0;
  const buyPressure = cand.buys / Math.max(1, cand.buys + cand.sells) * 100;

  // شروط الدخول: عدد مشترين كافٍ + ارتفاع مؤكد + ضغط شراء غالب
  if (cand.buys >= c.minBuySignals && pumpPct >= c.minPumpPct && buyPressure >= 70) {
    const nameOk = shouldSnipe(mint, cand.symbol, cand.symbol, 0);
    if (!nameOk.ok) { S.candidates.delete(mint); unsubscribeMintTrades(mint); return; }
    const ok = buyPaper(mint, cand.symbol, `زخم: ${cand.buys} مشتري +${pumpPct.toFixed(0)}%`);
    if (ok) {
      S.peaks.set(mint, cand.lastPrice);
      S.candidates.delete(mint);
      subscribeMintTrades(mint);
    }
  }
}

/** اشترك في صفقات توكن نحمله — أسعار حية حقيقية للمركز */
function subscribeMintTrades(mint: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
  }
}

/** إلغاء الاشتراك بعد انتهاء الرصد — يمنع تراكم الاشتراكات وقتل السرعة */
function unsubscribeMintTrades(mint: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify({ method: 'unsubscribeTokenTrade', keys: [mint] }));
    } catch { /* stream closed */ }
  }
  S.prices.delete(mint);
}

export function summary(): string {
  const s = stats();
  const total = s.wins + s.losses;
  const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '0';
  return `الجلسة: الرصيد ${s.equitySol.toFixed(4)} SOL | الربح ${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)} | صفقات ${total} (${winRate}% نجاح)`;
}

/* ─────────── بقاء الخلفية: خدمة أمامية + إعفاء بطارية + قفل معالج + نبض ─────────────────── */
declare global { interface Window { __abHb?: any; __abBoAsked?: boolean; } }

function isNative(): boolean {
  const Cap = (window as any).Capacitor;
  return !!(Cap?.isNativePlatform?.());
}

/** خدمة أمامية أندرويد: إشعار دائم يبقي العملية حية عند الخروج من التطبيق */
function startForegroundSvc() {
  if (!isNative()) return;
  try {
    const P = (window as any).Capacitor?.Plugins || {};
    // Android 13+ يطلب إذن الإشعارات صراحة — بدونه الخدمة الأمامية لا تظهر
    P.LocalNotifications?.requestPermissions?.().catch(() => {});
    const FS = P.ForegroundService;
    if (FS?.startForegroundService) {
      FS.startForegroundService({
        id: 9,
        title: 'AB-new يعمل',
        body: 'يراقب السوق ويدير مراكزك في الخلفية',
        smallIcon: 'ic_launcher',
        silent: true,
      }).catch(() => {});
    }
    // طلب إعفاء «تحسين البطارية» مرة واحدة — يمنع أندرويد من تجميد التطبيق
    const BO = P.BatteryOptimization;
    if (BO?.isBatteryOptimizationEnabled && !localStorage.getItem('ab_bo_asked')) {
      BO.isBatteryOptimizationEnabled().then((r: any) => {
        if (r?.enabled && BO.requestIgnoreBatteryOptimization) {
          localStorage.setItem('ab_bo_asked', '1');
          BO.requestIgnoreBatteryOptimization().catch(() => {});
        }
      }).catch(() => {});
    }
  } catch { /* web preview */ }
}

function stopForegroundSvc() {
  if (!isNative()) return;
  try {
    const P = (window as any).Capacitor?.Plugins || {};
    P.ForegroundService?.stopForegroundService?.().catch(() => {});
  } catch { /* not started */ }
}

/** قفل معالج (WakeLock) + نبض كل 15 ثانية يمنع تجميد WebView */
async function acquireKeepAwake() {
  try {
    if (isNative()) {
      const KN = (window as any).Capacitor?.Plugins?.KingNative;
      await KN?.acquireWakeLock?.();
      if (!window.__abHb) {
        window.__abHb = setInterval(() => {
          try { KN?.heartbeat?.().catch(() => {}); } catch { /* frozen */ }
        }, 15_000);
      }
    }
  } catch { /* web preview */ }
  startForegroundSvc();
}

async function releaseKeepAwake() {
  try {
    if (isNative()) {
      const KN = (window as any).Capacitor?.Plugins?.KingNative;
      await KN?.releaseWakeLock?.();
    }
    if (window.__abHb) { clearInterval(window.__abHb); window.__abHb = null; }
  } catch { /* web preview */ }
  stopForegroundSvc();
}

export function fmtSol(v: number): string {
  return v.toFixed(4);
}
export function fmtTime(t: number): string {
  return new Date(t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
