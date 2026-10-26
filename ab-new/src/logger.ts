export type Level = 'info' | 'warn' | 'error' | 'success';

export interface Logger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  success(msg: string, data?: unknown): void;
}

export class ConsoleLogger implements Logger {
  private ts(): string {
    return new Date().toISOString().slice(11, 23);
  }
  info(msg: string, data?: unknown): void { console.log(`[${this.ts()}] ℹ ${msg}`, data ?? ''); }
  warn(msg: string, data?: unknown): void { console.log(`[${this.ts()}] ⚠ ${msg}`, data ?? ''); }
  error(msg: string, data?: unknown): void { console.error(`[${this.ts()}] ✖ ${msg}`, data ?? ''); }
  success(msg: string, data?: unknown): void { console.log(`[${this.ts()}] ✔ ${msg}`, data ?? ''); }
}
