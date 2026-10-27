#!/usr/bin/env node
/**
 * AB-new Connection Relay Server — مثبّت اتصال دائم للبوت.
 * يعمل على أي VPS/Termux: يحافظ على بث PumpPortal حيًا دائمًا ويعيد
 * تغذية التطبيق فور عودته — لا فجوات بيانات حتى لو انقطع جوالك.
 *
 * التشغيل:  node abnew-relay.mjs          (افتراضي منفذ 8799)
 * أو:       PORT=9000 node abnew-relay.mjs
 */
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';

const PORT = Number(process.env.PORT || 8799);
const UPSTREAM = 'wss://pumpportal.fun/api/data';

/* ─── upstream: بث دائم مع إعادة اتصال فورية ─── */
let upstream = null;
let upstreamOk = false;
let backoff = 500;
const clientSubs = new Set();       // توكنات مشترك بها عملاء حالياً
let newTokenRequested = false;
let recent = [];                    // آخر 500 رسالة (ذاكرة عازلة لمن انقطع)

function connectUpstream() {
  try { upstream = new WebSocket(UPSTREAM); } catch { return schedule(); }
  upstream.on('open', () => {
    upstreamOk = true; backoff = 500;
    if (newTokenRequested) upstream.send(JSON.stringify({ method: 'subscribeNewToken' }));
    for (const mint of clientSubs)
      upstream.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [mint] }));
    console.log(`[relay] upstream متصل — يبث لـ ${wss.clients.size} عميل`);
  });
  upstream.on('message', (raw) => {
    const str = raw.toString();
    recent.push(str);
    if (recent.length > 500) recent.splice(0, recent.length - 500);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(str);
  });
  upstream.on('close', () => { upstreamOk = false; schedule(); });
  upstream.on('error', () => { try { upstream.close(); } catch {} });
}
function schedule() {
  setTimeout(connectUpstream, backoff);
  backoff = Math.min(5000, backoff * 1.6);
}
connectUpstream();
// نبض يمنع موت الاتصال الصامت
setInterval(() => { try { upstream?.ping(); } catch {} }, 15000);

/* ─── خادم HTTP: فحص صحة + صفحة حالة ─── */
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, upstream: upstreamOk, clients: wss.clients.size, buffered: recent.length }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset=utf-8><body style="font:14px/1.8 monospace;background:#0a0e14;color:#22c55e;padding:20px">
  <h2>AB-new Relay ✓</h2>
  upstream: ${upstreamOk ? '🟢 متصل' : '🔴 منقطع'}<br>
  عملاء أحياء: ${wss.clients.size}<br>
  عازلة الرسائل: ${recent.length}<br>
  <small>اضبط التطبيق: الإعدادات ← عنوان السيرفر ws://IP:PORT</small></body>`);
});

/* ─── WebSocket للعملاء (التطبيق) ─── */
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  console.log('[relay] عميل متصل');
  // أرسل ما فاته من العازلة فوراً — لا فجوات
  for (const m of recent) if (ws.readyState === WebSocket.OPEN) ws.send(m);
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'subscribeNewToken') newTokenRequested = true;
      if (msg.method === 'subscribeTokenTrade') for (const k of msg.keys || []) clientSubs.add(k);
      if (msg.method === 'unsubscribeTokenTrade') for (const k of msg.keys || []) clientSubs.delete(k);
      if (upstreamOk && upstream?.readyState === WebSocket.OPEN) upstream.send(raw.toString());
    } catch {}
  });
  ws.on('close', () => console.log('[relay] عميل انقطع'));
  ws.on('error', () => {});
  // نبض للعميل
  const hb = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 15000);
  ws.on('close', () => clearInterval(hb));
});

server.listen(PORT, () => console.log(`[relay] AB-new relay يعمل على منفذ ${PORT}`));
