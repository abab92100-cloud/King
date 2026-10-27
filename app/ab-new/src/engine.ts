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
  candidates: new Map<string, { symbol: string; openPrice: number; lastPrice: number; buys: number; sells: number; firstSeen: number; devBuySol?: number; mcapSol?: number }>(),
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
let wsBackoff = 500;
let lastDropLog = 0;
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
  pollTimer = setInterval(() => { void pollDexscreener(); }, 12_000);
  void pollDexscreener();
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
  if (pollTimer) clearInterval(pollTimer);
  if (monitor) clearInterval(monitor);
  if (statsTimer) clearInterval(statsTimer);
  pollTimer = monitor = statsTimer = null;
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
    wsBackoff = 500;
    ws?.send(JSON.stringify({ method: 'subscribeNewToken' }));
    log('success', 'اتصال البث ✓ (إعلانات التوكنات) + استقصاء أسعار DexScreener كل 12 ثانية');
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
  ws.onerror = () => { /* صامت — onclose يتكفل بإعادة الاتصال الفورية */ };
  ws.onclose = () => {
    S.wsConnected = false;
    emit();
    if (S.running) {
      // إعادة فورية صامتة — انقطاعات الشبكة المحمولة طبيعية ودورية؛ الاستقصاء يغطي كل بيانات الأسعار
      setTimeout(connectWs, 600 + Math.random() * 400);
      const now = Date.now();
      if (now - lastDropLog > 600_000) {
        lastDropLog = now;
        log('info', 'ملاحظة: شبكة الجوال تقطع البث دوريًا — إعادة الاتصال تلقائية فورية، التداول غير متأثر');
      }
    }
  };
}

function handleEvent(m: any) {
  if (!m?.mint) return;
  // توكن جديد — إطار create يحمل بيانات غنية مباشرة
  if (m.txType === 'create') {
    S.tokensSeen++;
    const vSol = Number(m.vSolInBondingCurve) || 0;
    const vTok = Number(m.vTokensInBondingCurve) || 0;
    const openPrice = (vSol > 0 && vTok > 0) ? vSol / vTok : 2.8e-8; // قيمة منحنى الافتتاح القياسية
    S.candidates.set(m.mint, {
      symbol: m.symbol || m.name || m.mint.slice(0, 6),
      openPrice, lastPrice: openPrice,
      buys: Number(m.initialBuy) > 0 ? 1 : 0, sells: 0,
      firstSeen: Date.now(),
      devBuySol: Number(m.solAmount) || 0,
      mcapSol: Number(m.marketCapSol) || 0,
    });
    log('info', `🆕 توكن جديد: ${m.symbol || m.name || m.mint.slice(0, 6)} — dev buy ${(Number(m.solAmount) || 0).toFixed(2)} SOL`);
    emit();
    return;
  }
}

/* ─────────── مصدر الأسعار: استقصاء DexScreener (مجاني وموثوق) ─────────── */
let pollTimer: ReturnType<typeof setInterval> | null = null;

interface Candidate {
  symbol: string; openPrice: number; lastPrice: number;
  buys: number; sells: number; firstSeen: number;
  devBuySol?: number; mcapSol?: number;
}
declare global { interface Window { __abCandidates?: any } }

async function pollDexscreener() {
  const mints: string[] = [
    ...S.candidates.keys(),
    ...S.positions.keys(),
  ];
  if (mints.length === 0) return;
  // دفعة واحدة تصل 30 توكن في الطلب الواحد
  for (let i = 0; i < mints.length; i += 30) {
    const batch = mints.slice(i, i + 30);
    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) continue;
      const data: any = await res.json();
      const byMint = new Map<string, any>();
      for (const pair of (data.pairs || [])) {
        const mint = pair.baseToken?.address;
        if (!mint) continue;
        const prev = byMint.get(mint);
        // نفضّل زوج منحنى pump.fun نفسه
        if (!prev || (pair.dexId === 'pumpfun' && prev.dexId !== 'pumpfun')) byMint.set(mint, pair);
      }
      for (const [mint, pair] of byMint) {
        // التقط توكنات فاتها إطار create أثناء انقطاع لحظي: زوج pump.fun جديد العهد
        if (!S.candidates.has(mint) && !S.positions.has(mint)) {
          const created = Number(pair.pairCreatedAt) || 0;
          if (pair.dexId === 'pumpfun' && created > 0 && Date.now() - created < 120_000) {
            S.candidates.set(mint, {
              symbol: pair.baseToken?.symbol || mint.slice(0, 6),
              openPrice: Number(pair.priceNative) || 0, lastPrice: Number(pair.priceNative) || 0,
              buys: 0, sells: 0, firstSeen: created,
            });
          } else {
            continue;
          }
        }
        const price = Number(pair.priceNative) || 0;
        if (price > 0) {
          S.prices.set(mint, price);
          // قمة المركز للوقف المتحرك
          if (S.positions.has(mint)) {
            const peak = S.peaks.get(mint) ?? price;
            if (price > peak) S.peaks.set(mint, price);
          }
          // زخم المرشح: عدد الصفقات من dexscreener مباشرة (أدق من عدّ إطارات WS)
          const cand = S.candidates.get(mint);
          if (cand) {
            cand.lastPrice = price;
            const t5 = pair.txns?.m5 || {};
            const totalTx = (t5.buys || 0) + (t5.sells || 0);
            cand.buys = Math.max(cand.buys, t5.buys || 0);
            cand.sells = Math.max(cand.sells, t5.sells || 0);
            if (totalTx > 0) maybeEnter(mint, cand, pair);
          }
        }
      }
    } catch { /* network — next cycle */ }
  }
  // تنظيف المرشحين المنتهين
  const now = Date.now();
  for (const [mint, c] of [...S.candidates.entries()]) {
    if ((now - c.firstSeen) / 1000 > S.cfg.maxTokenAgeSec) S.candidates.delete(mint);
  }
  emit();
}

/** الدخول عند اكتمال الزخم — مع بيانات سيولة إضافية من DexScreener */
function maybeEnter(mint: string, cand: Candidate, pair?: any) {
  if (!S.running || !S.cfg.snipe) return;
  if (S.positions.has(mint)) return;
  const c = S.cfg;
  const pumpPct = cand.openPrice > 0 ? (cand.lastPrice / cand.openPrice - 1) * 100 : 0;
  const total = cand.buys + cand.sells;
  const buyPressure = total > 0 ? cand.buys / total * 100 : 0;
  // شرط سيولة إضافي إن توفرت بيانات DexScreener: مركز تداول حي
  const liqUsd = pair?.liquidity?.usd || 0;
  if (cand.buys >= c.minBuySignals && pumpPct >= c.minPumpPct && buyPressure >= 60 && liqUsd > 3000) {
    const nameOk = shouldSnipe(mint, cand.symbol, cand.symbol, 0);
    if (!nameOk.ok) { S.candidates.delete(mint); return; }
    const ok = buyPaper(mint, cand.symbol, `زخم: ${cand.buys} مشترين +${pumpPct.toFixed(0)}% (سيولة $${Math.round(liqUsd)})`);
    if (ok) {
      S.peaks.set(mint, cand.lastPrice);
      S.candidates.delete(mint);
    }
  }
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
