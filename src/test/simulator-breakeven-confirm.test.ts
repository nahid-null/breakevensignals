// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

const instance = '11111111-1111-4111-8111-111111111111';
let db: PGlite; let rev: number; let minute: number;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort())
    await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null })]);
  await db.exec('update sim_account set balance=5, enabled=true;');
  rev = 0; minute = 60_000;
});
afterEach(async () => { await db.exec('ROLLBACK'); });
type Dir = 'LONG' | 'SHORT';
const ev = (event: string, direction: Dir, extra: Record<string, unknown> = {}) => ({ telegram_message: 'SIGNAL', event, event_id: `t1-${event}`, trade_id: 't1',
  symbol: 'NEARUSDT', direction, indicator: 'PRO SCALPER', timeframe: '1', entry_price: 100,
  stop_loss: direction === 'LONG' ? 99 : 101, take_profit: direction === 'LONG' ? 101.5 : 98.5, timestamp: new Date(minute + 60_000).toISOString(), fee_rate_percent: 0.04, ...extra });
async function candle(events: unknown[], o = 100, c = 100, mode = 'live') {
  minute += 60_000; const r = rev++;
  return db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: 'NEARUSDT', expected_revision: r, mode,
    checkpoint: { symbol: 'NEARUSDT', tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: o, high: Math.max(o, c) + 0.01, low: Math.min(o, c) - 0.01, close: c, volume: 1 }] },
    market: { symbol: 'NEARUSDT', price: c, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null }, events })]);
}
type Trend = { m15: number | null; m5: number | null; m1: number | null };
async function toBreakeven(d: Dir, mtf_trend: Trend | null = d === 'LONG' ? { m15: 1, m5: 1, m1: 0 } : { m15: -1, m5: -1, m1: 0 }) {
  await candle([ev('entry_confirmed', d)]);
  await candle([ev('breakeven_activated', d, { stop_loss: 100, ...(mtf_trend ? { mtf_trend } : {}) })]);
}
const trades = async () => (await db.query<{ entry_price: string; stop_loss: string; leverage: number; margin: string; rule_version: string }>('select * from sim_trades')).rows;
const decision = async () => (await db.query<{ status: string; reason: string | null }>("select status, reason from sim_breakeven_confirmations where trade_id='t1'")).rows[0];

describe('practice trades open only on a breakeven signal that matches the 15M/5M trend', () => {
  it('does not open a practice trade on the script entry alone', async () => {
    await candle([ev('entry_confirmed', 'LONG')]);
    expect(await trades()).toHaveLength(0);
  });
  it('LONG: 15m+5m bullish, 1m sideways opens at the breakeven trigger price at once', async () => {
    await toBreakeven('LONG');
    const t = (await trades())[0]!;
    // Pine entry 100, target 101.5 -> 1R = 1, breakeven trigger = 101; stop = Pine breakeven line 100.
    expect(Number(t.entry_price)).toBe(101); expect(Number(t.stop_loss)).toBe(100);
    expect(t.leverage).toBe(50); expect(Number(t.margin)).toBe(4); expect(t.rule_version).toBe('PINE_BE_TREND');
    expect((await decision())?.status).toBe('CONFIRMED');
  });
  it('LONG: 1m bullish too is allowed', async () => {
    await toBreakeven('LONG', { m15: 1, m5: 1, m1: 1 });
    expect(await trades()).toHaveLength(1);
  });
  it('LONG: 1m bearish is skipped', async () => {
    await toBreakeven('LONG', { m15: 1, m5: 1, m1: -1 });
    expect(await trades()).toHaveLength(0); expect(await decision()).toEqual({ status: 'SKIPPED', reason: 'ONE_MINUTE_OPPOSITE' });
  });
  it('LONG breakeven is skipped when 15m+5m are bearish (short-only coin)', async () => {
    await toBreakeven('LONG', { m15: -1, m5: -1, m1: 0 });
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('BIAS_OPPOSITE_SIGNAL');
  });
  it('skips when 15m and 5m disagree', async () => {
    await toBreakeven('LONG', { m15: 1, m5: 0, m1: 0 });
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('NO_15M_5M_BIAS');
  });
  it('skips when the trend reading is missing', async () => {
    await toBreakeven('LONG', null);
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('TREND_UNKNOWN');
  });
  it('SHORT: 15m+5m bearish opens at the breakeven trigger price', async () => {
    await toBreakeven('SHORT');
    const t = (await trades())[0]!; expect(Number(t.entry_price)).toBe(99); expect(Number(t.stop_loss)).toBe(100);
  });
  it('closes at the stop when price returns to the breakeven line', async () => {
    await toBreakeven('LONG'); await candle([], 100.5, 99.9);
    const r = (await db.query<{ status: string; exit_reason: string; pnl: string }>('select status, exit_reason, pnl from sim_trades')).rows[0]!;
    expect(r.status).toBe('CLOSED'); expect(r.exit_reason).toBe('STOP_LOSS'); expect(Number(r.pnl)).toBeLessThan(0);
  });
  it('skips when the simulator is switched off', async () => {
    await db.exec('update sim_account set enabled=false');
    await toBreakeven('LONG');
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('SIMULATOR_OFF');
  });
  it('zero balance skips entry without inventing a trade', async () => {
    await db.exec('update sim_account set balance=0');
    await toBreakeven('LONG');
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('NO_BALANCE');
  });
  it('a positive dust balance rounds margin to zero and rolls back the candle, unlike the old JS report', async () => {
    await candle([ev('entry_confirmed', 'LONG')]);
    await db.exec('SAVEPOINT dust; update sim_account set balance=0.000000005462295425681328');
    await expect(candle([ev('breakeven_activated','LONG',{stop_loss:100,mtf_trend:{m15:1,m5:1,m1:0}})])).rejects.toThrow(/division by zero/i);
    await db.exec('ROLLBACK TO dust');
    expect(await trades()).toHaveLength(0);
    expect(await decision()).toBeUndefined();
    expect(Number((await db.query<{balance:string}>('select balance from sim_account')).rows[0]?.balance)).toBe(5);
  });
});
