import { VersionedTransaction, Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PUMP_PORTAL_TRADE_LOCAL, type BotConfig } from './config.js';
import type { Logger } from './logger.js';

export interface TradeResult {
  signature: string;
  confirmed: boolean;
  error?: string;
}

/**
 * Build a pump.fun trade transaction via PumpPortal Local API, sign it locally,
 * and send it through our own RPC. Mirrors the verified pattern from
 * pumpportal.fun docs and ahk780/pumpfun-copy-trading-bot (sign-local path),
 * with confirmation + token-amount inspection from its jitoService.
 */
export class TradeExecutor {
  private connection: Connection;
  private keypair: Keypair;

  constructor(private config: BotConfig, private log: Logger) {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.keypair = Keypair.fromSecretKey(bs58.decode(config.privateKey));
    this.log.info(`wallet: ${this.keypair.publicKey.toBase58()}`);
  }

  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  async buildAndSign(action: 'buy' | 'sell', mint: string, amount: number, denominatedInSol: boolean): Promise<VersionedTransaction> {
    const body = {
      publicKey: this.keypair.publicKey.toBase58(),
      action,
      mint,
      denominatedInSol: String(denominatedInSol),
      amount,
      slippage: this.config.slippagePct,
      priorityFee: this.config.priorityFeeSol,
      pool: this.config.pool,
    };
    const res = await fetch(PUMP_PORTAL_TRADE_LOCAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`trade-local HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !(data instanceof Uint8Array) && typeof data !== 'string') {
      throw new Error('unexpected trade-local response');
    }
    const b64 = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
    const raw = Uint8Array.from(Buffer.from(b64, 'base64'));
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([this.keypair]);
    return tx;
  }

  async trade(action: 'buy' | 'sell', mint: string, amount: number, denominatedInSol: boolean): Promise<TradeResult> {
    const tx = await this.buildAndSign(action, mint, amount, denominatedInSol);
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const confirmed = await this.confirm(sig);
    return { signature: sig, confirmed: confirmed.ok, error: confirmed.err };
  }

  private async confirm(signature: string, timeoutMs = 45_000): Promise<{ ok: boolean; err?: string }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const status = await this.connection.getSignatureStatus(signature);
        const v = status?.value;
        if (v?.err) return { ok: false, err: JSON.stringify(v.err) };
        if (v?.confirmationStatus === 'confirmed' || v?.confirmationStatus === 'finalized') return { ok: true };
      } catch {
        // network hiccup — keep polling
      }
      await new Promise(r => setTimeout(r, 1_000));
    }
    return { ok: false, err: 'confirmation timeout' };
  }

  /** Read actual token balance for a mint (used before selling 100%). */
  async tokenBalance(mint: string): Promise<number> {
    const accounts = await this.connection.getTokenAccountsByOwner(
      new PublicKey(this.keypair.publicKey),
      { mint: new PublicKey(mint) }
    );
    if (accounts.value.length === 0) return 0;
    const bal = await this.connection.getTokenAccountBalance(accounts.value[0].pubkey);
    return Number(bal.value.amount) / 10 ** (bal.value.decimals ?? 6);
  }
}
