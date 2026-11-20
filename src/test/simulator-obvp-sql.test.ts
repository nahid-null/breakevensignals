// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

// prompt-51 rule (retired by prompt-63, migrations up to 0043 only) against the real migrations in isolated PostgreSQL (never production).
const instance = '11111111-1111-4111-8111-111111111111';
let db: PGlite; let rev: number; let minute: number;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql' && f < '0044').sort())
    await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null })]);
  await db.exec("select sim_change_balance(0, true); update app_settings set telegram_enabled=true, long_notifications_enabled=true, short_notifications_enabled=true;");
  rev = 0; minute = 4 * 60_000;
});
afterEach(async () => { await db.exec('ROLLBACK'); });
type Dir = 'LONG' | 'SHORT';
type Trend = { m15: number | null; m5: number | null; m1: number | null };
const bias = (d: Dir, m1 = 0): Trend => d === 'LONG' ? { m15: 1, m5: 1, m1 } : { m15: -1, m5: -1, m1: -m1 };
const ev = (event: string, direction: Dir, extra: Record<string, unknown> = {}, id = 't1') => ({ event, event_id: `${id}-${event}`, trade_id: id,
  symbol: 'NEARUSDT', direction, indicator: direction === 'LONG' ? 'PRO SCALPER' : 'PRO SCALPER SHORT', timeframe: '1', entry_price: 100,
  stop_loss: direction === 'LONG' ? 99 : 101, take_profit: direction === 'LONG' ? 101.5 : 98.5, timestamp: new Date(minute + 120_000).toISOString(), fee_rate_percent: 0.04, ...extra });
async function candle(events: unknown[], o = 100, c = 100, mode = 'live', hi?: number, lo?: number, entries: unknown[] = []) {
  minute += 60_000; const r = rev++;
  return db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: 'NEARUSDT', expected_revision: r, mode,
    checkpoint: { symbol: 'NEARUSDT', tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: o, high: hi ?? Math.max(o, c) + 0.01, low: lo ?? Math.min(o, c) - 0.01, close: c, volume: 1 }] },
    market: { symbol: 'NEARUSDT', price: c, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null }, events, simulator_entries: entries })]);
}
const ob = (direction: Dir, id = 't1', extra: Record<string, unknown> = {}) => ({ trade_id: id, symbol: 'NEARUSDT', direction, indicator: 'OB + Weighted VP 5m',
  timeframe: '5', entry_price: 100, stop_loss: direction === 'LONG' ? 99 : 101, take_profit: direction === 'LONG' ? 102 : 98, score: 3, rr: 3,
  signal_time: new Date(minute + 120_000).toISOString(), ...extra });
const enter = (d: Dir, id = 't1', extra: Record<string, unknown> = {}, mode = 'live') => candle([], 100, 100, mode, undefined, undefined, [ob(d, id, extra)]);
const trades = async () => (await db.query<{ direction: string; entry_price: string; stop_loss: string; take_profit: string; leverage: number; margin: string; rule_version: string; status: string; exit_reason: string | null; exit_price: string | null; notional: string }>('select * from sim_trades order by created_at')).rows;
const decision = async (id = 't1') => (await db.query<{ status: string; reason: string | null }>('select status, reason from sim_breakeven_confirmations where trade_id=$1', [id])).rows[0];
const messages = async () => (await db.query<{ message: string }>('select message from telegram_logs')).rows.map((r) => r.message);

describe('prompt-53 Simulator: OB + Weighted VP 5m entries only, 12 coins, 6 slots x 5%, 75x, no stop, +25% target, no time limit', () => {
  it('an indicator LONG opens at its exact entry price, 75x, 5% of balance, target +25% of margin', async () => {
    await enter('LONG');
    const t = (await trades())[0]!;
    expect(t.rule_version).toBe('OBVP5_CROSS'); expect(t.leverage).toBe(75); expect(Number(t.notional)).toBe(37.5); expect(Number(t.margin)).toBe(0.5);
    expect(Number(t.entry_price)).toBe(100);
    expect(Number(t.take_profit)).toBeCloseTo((100 * (1.0005 + 0.25 / 75) + 0.02) / 0.9995, 6);
    expect((await decision())?.status).toBe('CONFIRMED');
  });
  it('an indicator SHORT opens with no trend reading at all', async () => {
    await enter('SHORT');
    const t = (await trades())[0]!; expect(t.direction).toBe('SHORT'); expect(t.status).toBe('OPEN');
  });
  it('old Pine LONG/SHORT entries (1m and 5m) no longer open trades, even with an agreeing trend', async () => {
    await candle([ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG') })]);
    await candle([ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG'), timeframe: '5' }, 't2')]);
    expect(await trades()).toHaveLength(0);
  });
  it('entries during recovery are recorded as skipped, not traded', async () => {
    await enter('LONG', 't1', {}, 'recovery');
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('NOT_LIVE');
  });
  it('no 24-hour close: a losing trade is still open two days later', async () => {
    await enter('LONG');
    minute += 2 * 86_400_000;
    await candle([], 99.5, 99.5, 'live', 99.6, 99.4);
    expect((await trades())[0]!.status).toBe('OPEN');
  });
  it('a 5% move against the trade (well past the indicator stop level) does not close it', async () => {
    await enter('LONG');
    await candle([], 100, 95, 'live', 100, 95);
    expect((await trades())[0]!.status).toBe('OPEN');
  });
  it('closes only at +25% of margin (0.125 on 0.5 margin), not at the indicator take profit', async () => {
    await enter('LONG');
    await candle([], 100, 100.4, 'live', 100.42, 99.9);
    expect((await trades())[0]!.status).toBe('OPEN');
    await candle([], 100.4, 100.5, 'live', 100.5, 100.3);
    const t = (await trades())[0]!; expect(t.status).toBe('CLOSED'); expect(t.exit_reason).toBe('TAKE_PROFIT');
    const bal = Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance);
    expect(bal).toBeCloseTo(10.125, 6);
    const m = await messages(); expect(m).toHaveLength(1); expect(m[0]).toContain('Take profit hit'); expect(m[0]).toContain('Stop loss: none');
  });
  it('manual close still works and sends Closed manually', async () => {
    await enter('LONG');
    await candle([], 100, 100.2, 'live', 100.25, 99.9);
    const id = (await db.query<{ id: string }>('select id from sim_trades')).rows[0]!.id;
    await db.query('select sim_manual_close($1::uuid)', [id]);
    const t = (await trades())[0]!; expect(t.exit_reason).toBe('MANUAL_CLOSE'); expect(Number(t.exit_price)).toBe(100.2);
    expect((await messages())[0]).toContain('Closed manually');
  });
  it('six trades at once on different coins, each 5% of the main balance; a seventh is skipped', async () => {
    await enter('LONG');
    const coins = [['LINKUSDT', 't2'], ['BTCUSDT', 't3'], ['ETHUSDT', 't4'], ['SOLUSDT', 't5'], ['XRPUSDT', 't6'], ['ADAUSDT', 't7']] as const;
    for (const [sym, id] of coins) {
      minute += 60_000; const r = rev++;
      await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: sym, expected_revision: 0, mode: 'live',
        checkpoint: { symbol: sym, tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }] },
        market: { symbol: sym, price: 100, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null },
        events: [], simulator_entries: [ob('LONG', id, { symbol: sym })] })]);
      rev = r + 1;
    }
    const open = (await trades()).filter((t) => t.status === 'OPEN');
    expect(open).toHaveLength(6); expect(open.map((t) => Number(t.margin))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect((await decision('t7'))?.reason).toBe('ALL_SLOTS_IN_USE');
  });
  it('5% of a $1000 main balance is $50 margin per slot', async () => {
    await db.exec("update sim_account set balance=1000 where id=1");
    await enter('LONG');
    expect(Number((await trades())[0]!.margin)).toBe(50);
  });
  it('never two trades on the same coin', async () => {
    await enter('LONG'); await enter('SHORT', 't2');
    expect(await trades()).toHaveLength(1); expect((await decision('t2'))?.reason).toBe('COIN_ALREADY_OPEN');
  });
  it('cross margin: liquidation wipes the whole balance', async () => {
    await enter('LONG');
    await candle([], 100, 55, 'live', 100, 55);
    expect((await trades())[0]!.exit_reason).toBe('LIQUIDATED');
    expect(Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance)).toBe(0);
  });
  it('a signal on a coin outside the 12 approved coins never opens a trade', async () => {
    minute += 60_000;
    await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: 'INJUSDT', expected_revision: 0, mode: 'live',
      checkpoint: { symbol: 'INJUSDT', tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: 100, high: 100.01, low: 99.99, close: 100, volume: 1 }] },
      market: { symbol: 'INJUSDT', price: 100, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null },
      events: [], simulator_entries: [ob('LONG', 'inj1', { symbol: 'INJUSDT' })] })]);
    expect(await trades()).toHaveLength(0); expect((await decision('inj1'))?.reason).toBe('COIN_NOT_APPROVED');
  });
});
