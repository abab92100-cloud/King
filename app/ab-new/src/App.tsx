import { useEffect, useState } from 'react';
import {
  S, subscribe, startBot, stopBot, stats,
  persistCfg, type Cfg, fmtTime, sellPaper, type PaperPos, type TradeRec,
} from './engine';

/* ═══════════ ثيم KING المحسّن — خفيف وسريع ═══════════ */
const CSS = `
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:#0a0e14;color:#e8eef5;font:14px/1.6 -apple-system,'Segoe UI',Tahoma,sans-serif;overscroll-behavior:none}
.app{max-width:520px;margin:0 auto;min-height:100vh;padding-bottom:62px}
.hdr{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:9px;padding:calc(6px + env(safe-area-inset-top,0px)) 12px 6px;background:rgba(10,14,20,.94);backdrop-filter:blur(10px);border-bottom:1px solid #1c2536}
.logo{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;color:#fff;letter-spacing:-.5px}
.hdr .t{flex:1;min-width:0}
.hdr .t b{display:block;font-size:14px;line-height:1.2}
.hdr .t s{font-size:9px;color:#64748b;text-decoration:none;letter-spacing:.2em}
.badge{font-size:10px;font-weight:800;padding:4px 10px;border-radius:999px}
.badge.paper{background:rgba(14,165,233,.15);color:#38bdf8}
.badge.live{background:rgba(245,158,11,.15);color:#f59e0b}
.badge.run{background:rgba(34,197,94,.15);color:#22c55e}
.badge.stop{background:rgba(100,116,139,.15);color:#64748b}

.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:10px 12px 2px}
.stat{background:#11161f;border:1px solid #1c2536;border-radius:12px;padding:8px 10px}
.stat .k{font-size:10px;color:#64748b;font-weight:600}
.stat .v{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
.up{color:#22c55e}.dn{color:#f43f5e}

.hero{margin:8px 12px;padding:12px;border-radius:14px;background:linear-gradient(145deg,#11161f,#0d1220);border:1px solid #1c2536;display:flex;align-items:center;gap:12px}
.hero .eq{flex:1}
.hero .eq .k{font-size:10px;color:#64748b;font-weight:600}
.hero .eq .v{font-size:22px;font-weight:900;font-variant-numeric:tabular-nums}
.btn-run{border:none;border-radius:12px;padding:12px 18px;font-size:15px;font-weight:800;color:#fff;width:96px}
.btn-run.on{background:linear-gradient(135deg,#16a34a,#22c55e)}
.btn-run.off{background:linear-gradient(135deg,#b91c1c,#ef4444)}
.btn-run:active{transform:scale(.96)}

.sec{padding:10px 12px 0}
.sec h3{margin:0 0 8px;font-size:12px;font-weight:800;color:#94a3b8;display:flex;align-items:center;gap:6px}
.card{background:#11161f;border:1px solid #1c2536;border-radius:12px;padding:11px 12px;margin-bottom:8px}
.row{display:flex;align-items:center;gap:8px}
.sym{font-weight:800;font-size:14px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pill{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;font-variant-numeric:tabular-nums}
.pill.up{background:rgba(34,197,94,.13)}
.pill.dn{background:rgba(244,63,94,.13)}
.dim{font-size:10px;color:#64748b;font-variant-numeric:tabular-nums}
.dimline{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:#64748b}

.logbox{background:#070b12;border:1px solid #1c2536;border-radius:12px;padding:10px;max-height:340px;overflow-y:auto;font:11px/1.9 ui-monospace,monospace}
.ln-i{color:#64748b}.ln-s{color:#22c55e}.ln-w{color:#f59e0b}.ln-e{color:#f43f5e}
.ln-t{color:#3f4c63;margin-inline-end:6px}

.nav{position:fixed;bottom:0;left:0;right:0;z-index:30;background:rgba(10,14,20,.96);backdrop-filter:blur(12px);border-top:1px solid #1c2536}
.nav .in{max-width:520px;margin:0 auto;display:grid;grid-template-columns:repeat(4,1fr)}
.nav button{background:none;border:none;color:#54617a;padding:6px 0 7px;font-size:10px;font-weight:700}
.nav button.act{color:#0ea5e9}
.nav .ic{font-size:15px;display:block;line-height:1.1}

.set-row{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid #1a2233}
.set-row:last-child{border-bottom:none}
.set-row .k{font-size:13px;color:#cbd5e1;font-weight:600}
.set-row .k s{display:block;font-size:10px;color:#64748b;text-decoration:none}
.set-row input[type=number]{width:92px;background:#0d1220;border:1px solid #263148;border-radius:10px;color:#e8eef5;padding:8px 6px;font-size:13px;text-align:center;font-weight:700}
.set-row input[type=text]{flex:1;max-width:210px;background:#0d1220;border:1px solid #263148;border-radius:10px;color:#e8eef5;padding:8px 10px;font-size:12px}
.seg{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px 0}
.seg button{border:1px solid #263148;background:#0d1220;color:#64748b;border-radius:12px;padding:11px;font-size:12.5px;font-weight:800}
.seg button.act{border-color:#0ea5e9;color:#0ea5e9;background:rgba(14,165,233,.08)}
.switch{width:46px;height:26px;border-radius:999px;border:none;position:relative;background:#263148;transition:.2s}
.switch.on{background:#22c55e}
.switch i{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s}
.switch.on i{left:23px}
.empty{text-align:center;color:#3f4c63;padding:26px 0;font-size:12px}
.hint{font-size:10.5px;color:#475569;padding:2px 14px 10px;line-height:1.5}
`;
const Style = () => <style>{CSS}</style>;

/* ═══════════ hooks ═══════════ */
function useEngine() {
  const [, setN] = useState(0);
  useEffect(() => {
    const un = subscribe(() => setN(n => n + 1));
    return () => { if (typeof un === 'function') (un as any)(); };
  }, []);
}

const pnlCls = (v: number) => v >= 0 ? 'up' : 'dn';
const sign = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(4);

/* ═══════════ الرئيسية ═══════════ */
function Home({ go }: { go: (t: string) => void }) {
  useEngine();
  const s = stats();
  const closed = s.wins + s.losses;
  const wr = closed ? Math.round(s.wins / closed * 100) : 0;
  return (
    <>
      <div className="hero">
        <div className="eq">
          <div className="k">الرصيد الورقي</div>
          <div className="v">{s.equitySol.toFixed(4)}<span style={{ fontSize: 12, color: '#64748b' }}> SOL</span></div>
          <div className={`k ${pnlCls(s.realizedPnlSol)}`} style={{ fontWeight: 800 }}>
            {sign(s.realizedPnlSol)} SOL محقق
          </div>
        </div>
        <button
          className={`btn-run ${S.running ? 'off' : 'on'}`}
          onClick={() => S.running ? stopBot() : startBot()}
        >
          {S.running ? '⏹ إيقاف' : '▶ تشغيل'}
        </button>
      </div>

      <div className="stats">
        <div className="stat"><div className="k">نسبة النجاح</div><div className="v">{closed ? wr + '%' : '—'}</div></div>
        <div className="stat"><div className="k">رابحة</div><div className="v up">{s.wins}</div></div>
        <div className="stat"><div className="k">خاسرة</div><div className="v dn">{s.losses}</div></div>
        <div className="stat"><div className="k">مفتوحة</div><div className="v">{s.openPositions}</div></div>
        <div className="stat"><div className="k">توكنات مرصودة</div><div className="v">{S.tokensSeen}</div></div>
        <div className="stat"><div className="k">مرشحة نشطة</div><div className="v">{S.candidates.size}</div></div>
      </div>

      <div className="sec">
        <h3>📊 المراكز المفتوحة <span className="dim">{S.positions.size}</span></h3>
        {S.positions.size === 0 && <div className="empty">لا مراكز — البوت يرصد الزخم قبل الدخول</div>}
        {[...S.positions.values()].map((p: PaperPos) => (
          <div className="card" key={p.mint}>
            <div className="row">
              <span className="sym">{p.symbol}</span>
              <span className={`pill ${pnlCls(p.pnlPct)}`}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%</span>
              <span className="dim">{fmtTime(p.entryTime)}</span>
            </div>
            <div className="dimline"><span>دخول {p.entrySol} SOL</span><span>{(p.tokenAmount / 1e6).toFixed(1)}M توكن</span></div>
          </div>
        ))}
      </div>
      <div className="hint">البوت يراقب كل توكن جديد كمرشح — الدخول فقط عند اكتمال الزخم (مشترين كافٍ + ارتفاع مؤكد + ضغط شراء). لا صفقات لساعات؟ هذا طبيعي وصحي.</div>
    </>
  );
}

/* ═══════════ المراكز ═══════════ */
function Positions() {
  useEngine();
  return (
    <div className="sec" style={{ paddingTop: 14 }}>
      <h3>📊 المراكز المفتوحة ({S.positions.size})</h3>
      {S.positions.size === 0 && <div className="empty">لا مراكز مفتوحة</div>}
      {[...S.positions.values()].map((p: PaperPos) => (
        <div className="card" key={p.mint}>
          <div className="row">
            <span className="sym">{p.symbol}</span>
            <span className={`pill ${pnlCls(p.pnlPct)}`}>{p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(1)}%</span>
            <button
              className="pill dn" style={{ border: 'none', cursor: 'pointer' }}
              onClick={() => sellPaper(p.mint, 'بيع يدوي')}
            >بيع</button>
          </div>
          <div className="dimline">
            <span>{p.entrySol} SOL</span>
            <span>{(p.tokenAmount / 1e6).toFixed(1)}M توكن</span>
            <span>قمة: {((S.peaks.get(p.mint) ?? p.entryPriceSol) / p.entryPriceSol * 100 - 100).toFixed(0)}%</span>
          </div>
          <div className="dimline"><span>{p.mint.slice(0, 20)}…</span><span>{fmtTime(p.entryTime)}</span></div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════ السجل ═══════════ */
function Journal() {
  useEngine();
  const cls: Record<string, string> = { success: 'ln-s', warn: 'ln-w', error: 'ln-e', info: 'ln-i' };
  return (
    <div className="sec" style={{ paddingTop: 14 }}>
      <h3>📜 الصفقات ({S.trades.length})</h3>
      {S.trades.length === 0 && <div className="empty">لا صفقات بعد</div>}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {S.trades.map((t: TradeRec, i: number) => (
          <div className="card" key={i} style={{ padding: '8px 12px' }}>
            <div className="row">
              <span className={`pill ${t.side === 'buy' ? 'up' : t.pnlSol >= 0 ? 'up' : 'dn'}`}>
                {t.side === 'buy' ? 'شراء' : t.pnlSol >= 0 ? 'ربح' : 'خسارة'}
              </span>
              <span className="sym" style={{ fontSize: 13 }}>{t.symbol}</span>
              <span className={`dim ${pnlCls(t.pnlSol)}`} style={{ fontWeight: 800 }}>
                {t.side === 'sell' ? sign(t.pnlSol) : t.solAmount + ' SOL'}
              </span>
            </div>
            <div className="dimline"><span>{t.reason}</span><span>{fmtTime(t.time)}</span></div>
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 10 }}>🖥️ السجل المباشر</h3>
      <div className="logbox">
        {S.logs.length === 0 && <div className="empty">—</div>}
        {S.logs.map((l, i) => (
          <div key={i} className={cls[l.level]}>
            <span className="ln-t">{fmtTime(l.t)}</span>{l.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════ الإعدادات ═══════════ */
function Settings() {
  useEngine();
  const [c, setC] = useState<Cfg>(S.cfg);
  const upd = (k: keyof Cfg, v: any) => {
    const n = { ...c, [k]: v };
    setC(n); S.cfg = n; persistCfg(n);
  };
  const N = ({ k, label, sub, step }: { k: keyof Cfg; label: string; sub?: string; step: number }) => (
    <div className="set-row">
      <div className="k">{label}{sub && <s>{sub}</s>}</div>
      <input type="number" step={step} value={c[k] as number} onChange={e => upd(k, Number(e.target.value) || 0)} />
    </div>
  );
  return (
    <div className="sec" style={{ paddingTop: 14 }}>
      <h3>⚙️ الوضع</h3>
      <div className="card">
        <div className="seg">
          <button className={c.mode === 'paper' ? 'act' : ''} onClick={() => upd('mode', 'paper')}>📝 ورقي (تجربة)</button>
          <button className={c.mode === 'live' ? 'act' : ''} onClick={() => upd('mode', 'live')}>⚡ حقيقي</button>
        </div>
        <div className="set-row">
          <div className="k">سيرفر مثبّت<s>ws://ip:port — بث دائم بلا انقطاع</s></div>
          <input type="text" value={c.relayUrl} placeholder="اتصال مباشر" onChange={e => upd('relayUrl', e.target.value)} />
        </div>
      </div>

      <h3>🎯 الزخم (شروط الدخول)</h3>
      <div className="card">
        <div className="set-row">
          <div className="k">قنص التوكنات الجديدة</div>
          <button className={`switch ${c.snipe ? 'on' : ''}`} onClick={() => upd('snipe', !c.snipe)}><i /></button>
        </div>
        <N k="minBuySignals" label="عدد المشترين المطلوب" sub="زخم شراء حقيقي قبل الدخول" step={1} />
        <N k="minPumpPct" label="ارتفاع مؤكد %" sub="من سعر الافتتاح" step={5} />
        <N k="maxTokenAgeSec" label="أقصى عمر (ثوانٍ)" sub="أحدث توكنات فقط" step={10} />
      </div>

      <h3>🛡️ إدارة المخاطر</h3>
      <div className="card">
        <N k="buyAmountSol" label="حجم الشراء SOL" step={0.005} />
        <N k="takeProfitPct" label="جني الأرباح %" step={5} />
        <N k="stopLossPct" label="وقف الخسارة %" step={5} />
        <N k="trailStopPct" label="وقف متحرك %" sub="هبوط من القمة يحفظ الربح" step={5} />
        <N k="holdTimeoutMs" label="مهلة الحمل (دقيقة)" step={60000} />
        <N k="maxOpenPositions" label="أقصى مراكز" step={1} />
      </div>

      <h3>🧩 فلاتر</h3>
      <div className="card">
        <div className="set-row">
          <div className="k">محافظ النسخ</div>
          <input type="text" value={c.copyWallets} placeholder="عنوان,عنوان" onChange={e => upd('copyWallets', e.target.value)} />
        </div>
        <div className="set-row">
          <div className="k">أسماء محجوبة</div>
          <input type="text" value={c.blockNames} placeholder="PEPE,SCAM" onChange={e => upd('blockNames', e.target.value)} />
        </div>
      </div>
      <div className="hint">القيم المثبتة من دراسة المستودعات المفتوحة: 6 مشترين + ارتفاع 25%+ وضغط شراء 70%+ قبل الدخول، ووقف متحرك 15% من القمة.</div>
    </div>
  );
}

/* ═══════════ الهيكل ═══════════ */
const TABS = [
  { id: 'home', label: 'الرئيسية', ic: '🏠' },
  { id: 'pos', label: 'المراكز', ic: '📊' },
  { id: 'jrnl', label: 'السجل', ic: '📜' },
  { id: 'set', label: 'الإعدادات', ic: '⚙️' },
];

export default function App() {
  const [tab, setTab] = useState('home');
  return (
    <div className="app" dir="rtl">
      <Style />
      <header className="hdr">
        <div className="logo">AB</div>
        <div className="t"><b>AB-new</b><s>PUMP.FUN BOT</s></div>
        <span className={`badge ${S.cfg.mode === 'paper' ? 'paper' : 'live'}`}>{S.cfg.mode === 'paper' ? 'ورقي' : 'حقيقي'}</span>
        <span className={`badge ${S.running ? 'run' : 'stop'}`}>{S.running ? 'يعمل' : 'متوقف'}</span>
      </header>
      {tab === 'home' && <Home go={setTab} />}
      {tab === 'pos' && <Positions />}
      {tab === 'jrnl' && <Journal />}
      {tab === 'set' && <Settings />}
      <nav className="nav">
        <div className="in">
          {TABS.map(t => (
            <button key={t.id} className={tab === t.id ? 'act' : ''} onClick={() => setTab(t.id)}>
              <span className="ic">{t.ic}</span>{t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
