# AB-new — Pump.fun Sniper & Copy-Trading Bot

بوت تداول Solana لـ **pump.fun** مبني على أفضل الممارسات المستخرجة من دراسة تفصيلية لثلاثة مستودعات مرجعية + توثيق PumpPortal الرسمي.

## المرجعية الهندسية (ما تم التحقق منه بدقة)

| المصدر | ما استفدناه منه |
|---|---|
| `chainstacklabs/pump-fun-bot` | بنية تعليمات `buy_v2`/`sell_v2` الحقيقية (27 حسابًا مرتبًا)، مشتقات PDA (`bonding-curve`, `creator-vault`, `user_volume_accumulator`, `sharing-config`)، ثوابت البرنامج، فلاتر `max_token_age` ومرشحات الأسماء، تصنيف فشل الصفقة (reverted vs unknown) لمنع البيع المزدوج |
| `ahk780/pumpfun-copy-trading-bot` | مسار "التوقيع المحلي": جلب معاملة غير موقعة → فك base64 → توقيعها محليًا → إرسالها عبر RPC خاص، مع فحص `preTokenBalances/postTokenBalances` لمعرفة كمية التوكن الفعلية، وبيع 100% من الرصيد الفعلي |
| `1fge/pump-fun-sniper-bot` | الربط بالمحفظة (base58 PRIVATE_KEY)، سقف 70k compute units، رسوم الأولوية microlamports، فحص "متأخر على العملة" قبل الشراء لتفادي الأسعار المعلقة |
| **PumpPortal (توثيق رسمي)** | `POST /api/trade-local` (يبني المعاملة ونوقّعها نحن — لا مفتاح على خادم خارجي)، `wss://pumpportal.fun/api/data`: `subscribeNewToken` / `subscribeAccountTrade` / `subscribeMigration`، وبيع بنسبة مئوية `amount: 100` |

## الأمان
- المفتاح الخاص لا يغادر جهازك أبدًا: `trade-local` يُرجع معاملة غير موقعة ونحن نوقّعها محليًا.
- لا نستخدم Lightning API (الذي يخزّن محفظة ممولة لدى طرف ثالث) إلا إذا طلبت ذلك صراحة.

## التشغيل

```bash
npm install
cp .env.example .env
# ضع AB_PRIVATE_KEY (base58) ومحفظات النسخ
npm run build
npm start
```

## الاختبارات (بدون شبكة وبأموال صفرية)

```bash
npm test
```

تغطي: فلاتر sniping، TP/SL/timeout، حساب الأحجام مع الانزلاق، PnL، تطبيع رسائل WebSocket، والتحقق من صيغة المفتاح.

## الإعدادات (.env)

| المتغير | الوصف | الافتراضي |
|---|---|---|
| `AB_PRIVATE_KEY` | مفتاح المحفظة base58 (إلزامي) | — |
| `AB_RPC_URL` | RPC endpoint (مدفوع مُوصى به للسرعة) | public |
| `AB_SNIPE` | تفعيل sniper للتوكنات الجديدة | true |
| `AB_COPY_WALLETS` | محافظ النسخ مفصولة بفواصل | — |
| `AB_BUY_SOL` | حجم الشراء بالـ SOL | 0.01 |
| `AB_SLIPPAGE` | الانزلاق % | 10 |
| `AB_PRIORITY_FEE` | رسوم الأولوية بالـ SOL | 0.00005 |

## تحذير
تداول memecoin عالي المخاطر — استخدم محفظة صغيرة مخصصة للتجارب، وابدأ بمبالغ ضئيلة. هذا الكود للتعلم والتجريب.
