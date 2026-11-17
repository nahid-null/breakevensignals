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
async function toBreakeven(d: Dir) {
  await candle([ev('entry_confirmed', d)]);
  await candle([ev('breakeven_activated', d, { stop_loss: 100 })]);
}
const trades = async () => (await db.query<{ entry_price: string; stop_loss: string; leverage: number; margin: string; rule_version: string }>('select * from sim_trades')).rows;
const decision = async () => (await db.query<{ status: string; reason: string | null }>("select status, reason from sim_breakeven_confirmations where trade_id='t1'")).rows[0];

describe('practice trades open only on a confirmed breakeven signal', () => {
  it('does not open a practice trade on the script entry alone', async () => {
    await candle([ev('entry_confirmed', 'LONG')]);
    expect(await trades()).toHaveLength(0);
  });
  it('LONG: green next candle with open and close above entry opens at its close', async () => {
    await toBreakeven('LONG'); expect(await trades()).toHaveLength(0);
    await candle([], 100.2, 100.5);
    const t = (await trades())[0]!;
    expect(Number(t.entry_price)).toBe(100.5); expect(Number(t.stop_loss)).toBe(100);
    expect(t.leverage).toBe(50); expect(Number(t.margin)).toBe(4); expect(t.rule_version).toBe('PINE_BE_CONFIRM');
    expect((await decision())?.status).toBe('CONFIRMED');
  });
  it('LONG: red next candle above entry is skipped', async () => {
    await toBreakeven('LONG'); await candle([], 100.5, 100.2);
    expect(await trades()).toHaveLength(0); expect(await decision()).toEqual({ status: 'SKIPPED', reason: 'CANDLE_NOT_CONFIRMED' });
  });
  it('LONG: green candle that opens below entry is skipped', async () => {
    await toBreakeven('LONG'); await candle([], 99.9, 100.5);
    expect(await trades()).toHaveLength(0);
  });
  it('SHORT: red next candle with open and close below entry opens at its close', async () => {
    await toBreakeven('SHORT'); await candle([], 99.8, 99.5);
    const t = (await trades())[0]!; expect(Number(t.entry_price)).toBe(99.5); expect(Number(t.stop_loss)).toBe(100);
  });
  it('SHORT: green next candle below entry is skipped', async () => {
    await toBreakeven('SHORT'); await candle([], 99.5, 99.8);
    expect(await trades()).toHaveLength(0);
  });
  it('checks only one candle: a later confirming candle does not open a skipped signal', async () => {
    await toBreakeven('LONG'); await candle([], 100.5, 100.2); await candle([], 100.2, 100.6);
    expect(await trades()).toHaveLength(0);
  });
  it('skips when the simulator is switched off', async () => {
    await toBreakeven('LONG'); await db.exec('update sim_account set enabled=false');
    await candle([], 100.2, 100.5);
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('SIMULATOR_OFF');
  });
});
