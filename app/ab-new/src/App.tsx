import { useEffect, useState } from 'react';
import {
  S, subscribe, startBot, stopBot, stats, loadCfg, persistCfg,
  type Cfg, type PaperPos, type TradeRec, fmtSol, fmtTime, DEFAULT_CFG,
} from './engine';

/* ─────────── helpers ─────────── */
function useEngine() {
  const [, setN] = useState(0);
  useEffect(() => {
    const un = subscribe(() => setN(n => n + 1));
    return () => { if (typeof un === 'function') (un as any)(); };
  }, []);
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' | 'flat' }) {
  const c = tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-rose-400' : 'text-slate-200';
  return (
    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`text-base font-bold mt-0.5 ${c}`}>{value}</div>
    </div>
  );
}

function PnlPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${up ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
      {up ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

/* ─────────── Home screen ─────────── */
function Home({ go }: { go: (tab: string) => void }) {
  useEngine();
  const s = stats();
  const total = s.wins + s.losses;
  const winRate = total > 0 ? ((s.wins / total) * 100).toFixed(1) : '—';
  const pnlTone = s.realizedPnlSol >= 0 ? 'up' : 'down';
  return (
    <div className="space-y-4">
      {/* connection banner */}
      <div className={`rounded-xl p-3 flex items-center gap-2 border ${S.running ? (S.wsConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30') : 'bg-slate-900/70 border-slate-800'}`}>
        <span className={`w-2.5 h-2.5 rounded-full ${S.running ? (S.wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse') : 'bg-slate-500'}`} />
        <div className="text-sm font-bold text-slate-200">
          {S.running ? (S.wsConnected ? 'يعمل الآن — متصل بالسوق المباشر' : 'يعمل — يعيد الاتصال...') : 'متوقف'}
        </div>
        <div className="ms-auto text-[11px] text-slate-400">
          {S.cfg.mode === 'paper' ? '📝 ورقي' : '⚡ حقيقي'} · {S.tokensSeen} توكن
        </div>
      </div>

      {/* start/stop */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => !S.running && startBot()}
          disabled={S.running}
          className="rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-4 text-lg transition"
        >
          ▶ تشغيل
        </button>
        <button
          onClick={() => S.running && stopBot()}
          disabled={!S.running}
          className="rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold py-4 text-lg transition"
        >
          ⏹ إيقاف
        </button>
      </div>

      {/* stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="الرصيد (SOL)" value={fmtSol(s.equitySol)} />
        <Stat label="الربح المحقق" value={`${s.realizedPnlSol >= 0 ? '+' : ''}${s.realizedPnlSol.toFixed(6)}`} tone={pnlTone} />
        <Stat label="نسبة النجاح" value={`${winRate}%`} />
        <Stat label="مراكز مفتوحة" value={String(s.openPositions)} />
        <Stat label="رابحة / خاسرة" value={`${s.wins} / ${s.losses}`} />
        <Stat label="إجمالي الصفقات" value={String(s.totalTrades)} />
      </div>

      {/* open positions quick view */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-slate-200">المراكز المفتوحة</h3>
          <button className="text-xs text-sky-400" onClick={() => go('pos')}>عرض الكل ←</button>
        </div>
        {S.positions.size === 0 ? (
          <div className="text-center text-sm text-slate-500 py-6 rounded-xl bg-slate-900/50">لا مراكز مفتوحة</div>
        ) : (
          <div className="space-y-2">
            {[...S.positions.values()].slice(0, 3).map((p: PaperPos) => (
              <div key={p.mint} className="rounded-xl bg-slate-900/70 border border-slate-800 p-3 flex items-center">
                <div className="font-bold text-slate-100">{p.symbol || p.mint.slice(0, 6)}</div>
                <div className="ms-auto flex items-center gap-2">
                  <span className="text-xs text-slate-400">{fmtSol(p.entrySol)} SOL</span>
                  <PnlPill pct={p.pnlPct} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────── Positions screen ─────────── */
function Positions() {
  useEngine();
  return (
    <div className="space-y-3">
      <h3 className="font-bold text-slate-200">المراكز ({S.positions.size})</h3>
      {S.positions.size === 0 && (
        <div className="text-center text-sm text-slate-500 py-10">لا مراكز مفتوحة حالياً</div>
      )}
      {[...S.positions.values()].map((p: PaperPos) => (
        <div key={p.mint} className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
          <div className="flex items-center">
            <div className="font-bold text-slate-100">{p.symbol || p.mint.slice(0, 6)}</div>
            <PnlPill pct={p.pnlPct} />
            <div className="ms-auto text-xs text-slate-400">{fmtTime(p.entryTime)}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div>الدخول: {fmtSol(p.entrySol)} SOL</div>
            <div>الكمية: {(p.tokenAmount / 1e6).toFixed(2)}M</div>
            <div>سعر الدخول: {p.entryPriceSol.toExponential(2)}</div>
            <div className="truncate">العقد: {p.mint.slice(0, 14)}…</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────── Journal screen ─────────── */
function Journal() {
  useEngine();
  return (
    <div className="space-y-3">
      <h3 className="font-bold text-slate-200">سجل الصفقات ({S.trades.length})</h3>
      {S.trades.length === 0 && (
        <div className="text-center text-sm text-slate-500 py-10">لا صفقات بعد — شغّل البوت</div>
      )}
      {S.trades.map((t: TradeRec, i: number) => (
        <div key={i} className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${t.side === 'buy' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
              {t.side === 'buy' ? 'شراء' : 'بيع'}
            </span>
            <div className="font-bold text-slate-100">{t.symbol || t.mint.slice(0, 6)}</div>
            {t.side === 'sell' && (
              <span className={`text-xs font-bold ${t.pnlSol >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {t.pnlSol >= 0 ? '+' : ''}{t.pnlSol.toFixed(6)} SOL
              </span>
            )}
            <div className="ms-auto text-[11px] text-slate-500">{fmtTime(t.time)}</div>
          </div>
          <div className="mt-1 text-xs text-slate-400">{t.reason}</div>
        </div>
      ))}
      {/* logs */}
      <h3 className="font-bold text-slate-200 pt-4">السجل المباشر</h3>
      <div className="rounded-xl bg-black/40 border border-slate-800 p-3 max-h-72 overflow-y-auto text-[11px] font-mono leading-relaxed" dir="rtl">
        {S.logs.length === 0 && <div className="text-slate-500 text-center py-4">—</div>}
        {S.logs.map((l, i) => (
          <div key={i} className={
            l.level === 'success' ? 'text-emerald-400' :
            l.level === 'warn' ? 'text-amber-400' :
            l.level === 'error' ? 'text-rose-400' : 'text-slate-400'
          }>
            [{fmtTime(l.t)}] {l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────── Settings screen ─────────── */
function Settings() {
  useEngine();
  const [cfg, setCfg] = useState<Cfg>(S.cfg);
  function upd(k: keyof Cfg, v: any) {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    S.cfg = next;
    persistCfg(next);
  }
  function Num({ label, k, step, suffix }: { label: string; k: keyof Cfg; step: number; suffix?: string }) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm text-slate-300">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="number" step={step} value={cfg[k] as number}
            onChange={e => upd(k, Number(e.target.value))}
            className="w-28 bg-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-100 text-center border border-slate-700"
          />
          {suffix && <span className="text-xs text-slate-500">{suffix}</span>}
        </div>
      </div>
    );
  }
  function Txt({ label, k, ph }: { label: string; k: keyof Cfg; ph?: string }) {
    return (
      <div className="py-2">
        <div className="text-sm text-slate-300 mb-1">{label}</div>
        <input
          value={cfg[k] as string} placeholder={ph}
          onChange={e => upd(k, e.target.value)}
          className="w-full bg-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 border border-slate-700"
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* mode */}
      <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
        <div className="text-sm text-slate-300 mb-2 font-bold">وضع التداول</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => upd('mode', 'paper')}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${cfg.mode === 'paper' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            📝 ورقي (تجربة)
          </button>
          <button
            onClick={() => upd('mode', 'live')}
            className={`rounded-lg py-2.5 text-sm font-bold transition ${cfg.mode === 'live' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}
          >
            ⚡ حقيقي (أموال)
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          الورقي يحاكي بأموال افتراضية على أسعار حقيقية. الحقيقي يتطلب مفتاح المحفظة (قريبًا).
        </p>
      </div>

      {/* strategy numbers */}
      <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3 divide-y divide-slate-800">
        <Num label="رصيد البداية (ورقي)" k="startingSol" step={0.1} suffix="SOL" />
        <Num label="حجم كل شراء" k="buyAmountSol" step={0.005} suffix="SOL" />
        <Num label="جني الأرباح عند" k="takeProfitPct" step={5} suffix="%" />
        <Num label="وقف الخسارة عند" k="stopLossPct" step={5} suffix="%" />
        <Num label="أقصى مراكز مفتوحة" k="maxOpenPositions" step={1} />
        <Num label="مدة الحمل" k="holdTimeoutMs" step={60000} suffix="ms" />
        <Num label="مشترين مطلوبين قبل الدخول" k="minBuySignals" step={1} />
        <Num label="ارتفاع مؤكد مطلوب" k="minPumpPct" step={5} suffix="%" />
        <Num label="أقصى عمر للتوكن (ثانية)" k="maxTokenAgeSec" step={10} />
        <Num label="الوقف المتحرك من القمة" k="trailStopPct" step={5} suffix="%" />
      </div>

      {/* filters */}
      <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-3">
        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-slate-300">قنص التوكنات الجديدة</span>
          <button
            onClick={() => upd('snipe', !cfg.snipe)}
            className={`w-12 h-6 rounded-full transition relative ${cfg.snipe ? 'bg-emerald-600' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${cfg.snipe ? 'left-6' : 'left-0.5'}`} />
          </button>
        </div>
        <Txt label="محافظ النسخ (مفصولة بفاصلة)" k="copyWallets" ph="عنوان1, عنوان2" />
        <Txt label="أسماء محجوبة (regex بفواصل)" k="blockNames" ph="PEPE, SCAM" />
      </div>

      <button
        onClick={() => { setCfg({ ...DEFAULT_CFG }); S.cfg = { ...DEFAULT_CFG }; persistCfg({ ...DEFAULT_CFG }); }}
        className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 text-sm"
      >
        استعادة الإعدادات الافتراضية
      </button>
    </div>
  );
}

/* ─────────── App shell ─────────── */
const TABS = [
  { id: 'home', label: 'الرئيسية', icon: '🏠' },
  { id: 'pos', label: 'المراكز', icon: '📊' },
  { id: 'jrnl', label: 'السجل', icon: '📜' },
  { id: 'set', label: 'الإعدادات', icon: '⚙️' },
];

export default function App() {
  const [tab, setTab] = useState('home');
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 max-w-lg mx-auto" dir="rtl">
      {/* header */}
      <div className="sticky top-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-2">
        <div className="text-xl">🅰️🅱️</div>
        <div className="font-bold">AB-new <span className="text-xs text-slate-400 font-normal">بوت pump.fun</span></div>
        <div className="ms-auto">
          <span className={`text-[11px] px-2 py-1 rounded-full font-bold ${S.cfg.mode === 'paper' ? 'bg-sky-500/15 text-sky-400' : 'bg-amber-500/15 text-amber-400'}`}>
            {S.cfg.mode === 'paper' ? 'ورقي' : 'حقيقي'}
          </span>
        </div>
      </div>

      {/* content */}
      <div className="p-4 pb-24">
        {tab === 'home' && <Home go={setTab} />}
        {tab === 'pos' && <Positions />}
        {tab === 'jrnl' && <Journal />}
        {tab === 'set' && <Settings />}
      </div>

      {/* bottom nav */}
      <nav className="fixed bottom-0 inset-x-0 z-10 bg-slate-950/95 backdrop-blur border-t border-slate-800">
        <div className="max-w-lg mx-auto grid grid-cols-4">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3 text-center transition ${tab === t.id ? 'text-sky-400' : 'text-slate-500'}`}
            >
              <div className="text-lg leading-none">{t.icon}</div>
              <div className="text-[10px] mt-1 font-bold">{t.label}</div>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
