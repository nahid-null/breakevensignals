// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
let revisions: Record<string, number>;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql') && f !== '0001_migration.sql').sort())
    await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN'); revisions = {};
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: owner, status: 'RUNNING', error: null, websocket_connected: true, binance_connected: true, available_symbols: 20 })]);
  await db.exec("update sim2_account set session_started_at=to_timestamp(0)");
});
afterEach(async () => { await db.exec('ROLLBACK'); });
type Trade = { direction: string; entry_price: string; stop_loss: string; take_profit: string; leverage: number; margin: string; pnl: string; opened_at: string; closed_at: string; exit_reason: string; balance_after: string };
const trades = async () => (await db.query<Trade>('select * from sim2_trades order by closed_at')).rows;
async function last() { const t = (await trades()).at(-1); if (!t) throw new Error('Expected completed Simulator 2 trade'); return t; }
const account = async () => (await db.query<{ balance: string; pending_symbol: string | null; pending_direction: string | null; session_id: string; available_after_time: number }>('select * from sim2_account')).rows[0];
async function candle(time: number, o: number, h: number, l: number, c: number, symbol = 'NEARUSDT', mode = 'live', tick = 0.001) {
  const rev = revisions[symbol] ?? 0;
  const payload = { instance_id: owner, symbol, expected_revision: rev, mode, events: [],
    checkpoint: { symbol, lastTime: time, tickSize: tick, candles: [{ time, open: o, high: h, low: l, close: c, volume: 1 }] },
    market: { symbol, price: c, trend: 'WAITING', status: 'LIVE', last_candle_at: new Date(time + 60000).toISOString(), long_score: 0, short_score: 0, error: null } };
  const result = await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify(payload)]);
  revisions[symbol] = rev + 1;
  return { payload, result };
}
async function signal(short = false, symbol = 'NEARUSDT') {
  await candle(60000, 100, 100.1, 99.9, 100, symbol);
  await candle(120000, 100, short ? 100.01 : 100.3, short ? 99.7 : 99.99, short ? 99.75 : 100.25, symbol);
}

describe('Simulator 2 independent one-minute breakout rules', () => {
  it('starts with a separate $5 account and does not inherit Simulator capital', async () => {
    await db.exec('update sim_account set balance=17');
    expect(Number((await account())?.balance)).toBe(5);
  });
  it('LONG queues only a green close above the previous high', async () => {
    await signal(); expect((await account())?.pending_direction).toBe('LONG'); expect(await trades()).toHaveLength(0);
  });
  it('SHORT queues only a red close below the previous low', async () => {
    await signal(true); expect((await account())?.pending_direction).toBe('SHORT');
  });
  it('does not accept a bullish candle without a breakout', async () => {
    await candle(60000, 100, 101, 99.9, 100);
    await candle(120000, 100, 100.3, 99.99, 100.25);
    expect((await account())?.pending_symbol).toBeNull();
  });
  it('rejects a breakout candle with a body below 60% of range', async () => {
    await candle(60000, 100, 100.1, 99.9, 100);
    await candle(120000, 100, 101, 99, 100.25);
    expect((await account())?.pending_symbol).toBeNull();
  });
  it('accepts a breakout body of exactly 60%', async () => {
    await candle(60000, 100, 101, 99, 100);
    await candle(120000, 100, 104, 99, 103);
    expect((await account())?.pending_direction).toBe('LONG');
  });
  it('enters at the next candle open with 50x and exactly $4 margin from $5', async () => {
    await signal(); await candle(180000, 100.3, 100.31, 100.29, 100.3);
    const t = await last(); expect(Number(t.entry_price)).toBe(100.3); expect(t.leverage).toBe(50); expect(Number(t.margin)).toBe(4);
    expect(new Date(t.opened_at).getTime()).toBe(180000);
  });
  for (const short of [false, true]) {
    const direction = short ? 'SHORT' : 'LONG';
    it(`${direction}: +10% of $5 balance settles as $0.50 NET after fees/ticks`, async () => {
      await signal(short);
      await candle(180000, 100, short ? 100.001 : 101, short ? 99 : 99.999, 100);
      const t = await last(); expect(t.exit_reason).toBe('TAKE_PROFIT'); expect(Number(t.pnl)).toBeCloseTo(0.5, 10);
      expect(Number(t.balance_after)).toBeCloseTo(5.5, 10);
    });
    it(`${direction}: −5% of $5 balance settles as −$0.25 NET after fees/ticks`, async () => {
      await signal(short);
      await candle(180000, 100, short ? 100.1 : 100.001, short ? 99.999 : 99.9, 100);
      const t = await last(); expect(t.exit_reason).toBe('STOP_LOSS'); expect(Number(t.pnl)).toBeCloseTo(-0.25, 10);
      expect(Number(t.balance_after)).toBeCloseTo(4.75, 10);
    });
  }
  it('closes at the entry candle close when neither target nor stop is reached', async () => {
    await signal(); await candle(180000, 100, 100.005, 99.995, 100);
    const t = await last(); expect(t.exit_reason).toBe('ONE_CANDLE'); expect(Number(t.pnl)).toBeCloseTo(-0.204, 10);
    expect(new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()).toBe(60000);
  });
  it('stop wins when one candle touches both stop and target', async () => {
    await signal(); await candle(180000, 100, 101, 99, 100);
    expect((await last()).exit_reason).toBe('STOP_LOSS');
  });
  it('skips entry when tick costs consume the 5% modeled risk budget', async () => {
    await signal(); await candle(180000, 100, 101, 99, 100, 'NEARUSDT', 'live', 0.1);
    expect(await trades()).toHaveLength(0);
  });
  it('allows only one pending symbol and rejects overlapping out-of-order symbol candles', async () => {
    await signal(); await signal(true, 'LINKUSDT');
    expect((await account())?.pending_symbol).toBe('NEARUSDT');
    await candle(180000, 100, 101, 99.999, 100);
    await candle(180000, 100, 100.01, 99.7, 99.75, 'LINKUSDT');
    expect(await trades()).toHaveLength(1); expect((await account())?.pending_symbol).toBeNull();
  });
  it('never opens new trades during warmup or recovery', async () => {
    await candle(60000, 100, 100.1, 99.9, 100, 'NEARUSDT', 'warmup');
    await candle(120000, 100, 100.3, 99.99, 100.25, 'NEARUSDT', 'recovery');
    expect((await account())?.pending_symbol).toBeNull(); expect(await trades()).toHaveLength(0);
  });
  it('cancels a pending signal if its entry candle arrives as recovery', async () => {
    await signal(); await candle(180000, 100, 101, 99, 100, 'NEARUSDT', 'recovery');
    expect(await trades()).toHaveLength(0); expect((await account())?.pending_symbol).toBeNull();
  });
  it('does not use a later candle if the immediate next candle is missing', async () => {
    await signal(); await candle(240000, 100, 101, 99, 100);
    expect(await trades()).toHaveLength(0);
  });
  it('duplicate revision cannot create another settlement or change balance', async () => {
    await signal(); const { payload } = await candle(180000, 100, 101, 99.999, 100);
    const before = await account(); await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify(payload)]);
    expect(await trades()).toHaveLength(1); expect((await account())?.balance).toBe(before?.balance);
  });
  it('pause cancels pending entry and prevents new signals', async () => {
    await signal(); await db.exec('select sim2_set_enabled(false)');
    await candle(180000, 100, 101, 99, 100);
    expect(await trades()).toHaveLength(0); expect((await account())?.pending_symbol).toBeNull();
  });
  it('reset restores $5 and empty visible history while preserving archived results and original Simulator', async () => {
    await signal(); await candle(180000, 100, 101, 99.999, 100);
    const old = await account(); const original = await db.query('select * from sim_account');
    await db.exec('select sim2_reset()');
    const next = await account(); expect(Number(next?.balance)).toBe(5); expect(next?.session_id).not.toBe(old?.session_id);
    expect((await db.query('select * from sim2_trades where session_id=(select session_id from sim2_account)')).rows).toHaveLength(0);
    expect(await trades()).toHaveLength(1); expect((await db.query('select * from sim2_balance_events')).rows).toHaveLength(1);
    expect(await db.query('select * from sim_account')).toEqual(original);
  });
  it('does not adopt old signal candles after reset', async () => {
    await signal(); await db.exec('select sim2_reset()');
    await candle(180000, 100, 101, 99, 100); expect(await trades()).toHaveLength(0);
    expect((await account())?.pending_symbol).toBeNull();
  });
  it('does not create Pine entries or Telegram alerts for Simulator 2', async () => {
    await signal(); await candle(180000, 100, 101, 99.999, 100);
    for (const name of ['sim_trades','signal_events','telegram_logs']) expect((await db.query(`select * from ${name}`)).rows).toHaveLength(0);
  });
  it('recorded Binance restriction rejects a commit before any Simulator 2 settlement', async () => {
    await signal(); await db.exec("update engine_health set status='ERROR',error='BINANCE_ACCESS_RESTRICTED: HTTP 451'");
    await db.exec('SAVEPOINT restricted_commit');
    await expect(candle(180000, 100, 101, 99.999, 100)).rejects.toThrow();
    await db.exec('ROLLBACK TO SAVEPOINT restricted_commit');
    expect(await trades()).toHaveLength(0); expect(Number((await account())?.balance)).toBe(5);
  });
  it('browser roles have no table access or reset/enable execution', async () => {
    const rows = (await db.query<{ read: boolean; reset: boolean; enable: boolean }>("select has_table_privilege('anon','sim2_trades','SELECT') as read, has_function_privilege('anon','sim2_reset()','EXECUTE') as reset, has_function_privilege('authenticated','sim2_set_enabled(boolean)','EXECUTE') as enable")).rows;
    expect(rows).toEqual([{ read: false, reset: false, enable: false }]);
  });
});