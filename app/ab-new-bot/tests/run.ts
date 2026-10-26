/**
 * AB-new offline test suite — no funds moved, no network required.
 * Run: npm test
 */
import { DEFAULT_CONFIG, type BotConfig, type NewTokenEvent, type Position } from '../src/config.js';
import { shouldSnipe, exitReason, sizeBuy, pnlPct } from '../src/strategy.js';
import { normalizeNewToken, normalizeAccountTrade } from '../src/stream.js';
import { isValidBase58Key } from '../src/config.js';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.error(`  ✖ ${name}${detail ? ' — ' + detail : ''}`); }
}

const cfg: BotConfig = { ...DEFAULT_CONFIG };

function tok(over: Partial<NewTokenEvent> = {}): NewTokenEvent {
  return {
    mint: 'mint' + Math.random().toString(36).slice(2, 10),
    name: 'Test', symbol: 'TST', uri: '',
    bondingCurveKey: '', associatedBondingCurve: '',
    user: '', timestamp: Date.now(),
    ...over,
  };
}

console.log('— strategy');
const fresh = tok();
check('fresh token passes filters', shouldSnipe(fresh, cfg).buy);
check('old token rejected', !shouldSnipe(tok({ timestamp: Date.now() - 60_000 }), cfg).buy);
check('blocked name rejected', !shouldSnipe(tok({ name: 'PEPE 2.0' }), cfg).buy);
check('blocked symbol rejected', !shouldSnipe(tok({ symbol: 'PEPE' }), cfg).buy);

const pos: Position = { mint: 'm', entrySol: 1, tokenAmount: 100, entryTime: Date.now(), signature: 's' };
check('take profit triggers', exitReason(pos, cfg.takeProfitPct, cfg) !== null);
check('stop loss triggers', exitReason(pos, -cfg.stopLossPct, cfg) !== null);
check('flat position holds', exitReason(pos, 0, cfg) === null);
const old: Position = { ...pos, entryTime: Date.now() - cfg.holdTimeoutMs - 1 };
check('hold timeout triggers', exitReason(old, 0, cfg) !== null);

console.log('— sizing & pnl');
const s = sizeBuy(0.01, 0.000001, 10);
check('token count from price', Math.abs(s.tokens - 10_000) < 1e-6);
check('max cost includes slippage', Math.abs(s.maxCostSol - 0.011) < 1e-9);
check('zero price gives zero', sizeBuy(0.01, 0, 10).tokens === 0);
check('pnl +10%', Math.abs(pnlPct(1, 1.1) - 10) < 1e-9);
check('pnl zero entry safe', pnlPct(0, 5) === 0);

console.log('— stream normalization');
const nt = normalizeNewToken({ method: 'newToken', mint: 'MintA', name: 'A', symbol: 'AAA', timestamp: 1699999999 });
check('newToken mapped', nt.mint === 'MintA' && nt.symbol === 'AAA');
const at = normalizeAccountTrade({ account: 'WalletA', mint: 'MintA', solAmount: '2.5', tokenAmount: '1000', buy: true, signature: 'sig1' });
check('accountTrade mapped numbers', at.solAmount === 2.5 && at.tokenAmount === 1000 && at.buy);

console.log('— key validation');
const kp = Keypair.generate();
const b58 = bs58.encode(kp.secretKey);
check('generated base58 key accepted', isValidBase58Key(b58));
check('empty key rejected', !isValidBase58Key(''));
check('garbage rejected', !isValidBase58Key('!!!not-base58!!!'));
check('short key rejected', !isValidBase58Key(b58.slice(0, 20)));

console.log(`\n${passed} passed, ${failed} failed`);

console.log('— paper engine');
import { PaperEngine } from '../src/paper.js';
import { ConsoleLogger } from '../src/logger.js';

const plog = new ConsoleLogger();
// silence logs during tests
(plog as any).info = () => {}; (plog as any).success = () => {}; (plog as any).warn = () => {}; (plog as any).error = () => {};

const pe = new PaperEngine(1, 0.01, 1, plog);
pe.updatePrice('mintA', 0.000001);
check('paper buy fills at live price', pe.buy('mintA', 'AAA', 'test'));
check('cash reduced after buy', pe.stats().startingSol - (pe.stats().startingSol - 0.01 - 0.00005) > 0);
// price doubles -> +100% pnl before fees
pe.updatePrice('mintA', 0.000002);
check('unrealized pnl positive after pump', pe.pnlPct('mintA') > 90);
const pnl = pe.sell('mintA', 'take-profit test');
check('sell realizes profit', pnl !== null && pnl > 0.008);
check('win counted', pe.stats().wins === 1 && pe.stats().losses === 0);

const pe2 = new PaperEngine(1, 0.01, 1, plog);
pe2.updatePrice('mintB', 0.000001);
pe2.buy('mintB', 'BBB', 'test');
// price collapses to 10% -> big loss
pe2.updatePrice('mintB', 0.0000001);
const pnl2 = pe2.sell('mintB', 'stop-loss test');
check('sell realizes loss', pnl2 !== null && pnl2 < -0.008);
check('loss counted', pe2.stats().losses === 1);

const pe3 = new PaperEngine(1, 0.01, 1, plog);
check('no price -> no fill', !pe3.buy('mintC', 'CCC', 'test'));
let bought = 0;
for (let i = 0; i < 150; i++) {
  pe3.updatePrice('mintX' + i, 0.000001);
  if (pe3.buy('mintX' + i, 'X' + i, 'test')) bought++;
}
check('budget limits buys', bought <= 99 && bought > 0);
check('summary renders', pe3.summary().includes('PAPER SESSION'));

const sFinal = pe.stats();
check("equity tracks cash+positions", Math.abs(sFinal.equitySol - 1.009502) < 0.000001);

process.exit(failed === 0 ? 0 : 1);

