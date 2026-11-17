// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

// prompt-40 rule against the real migrations in isolated PostgreSQL (never production).
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
async function candle(events: unknown[], o = 100, c = 100, mode = 'live', hi?: number, lo?: number) {
  minute += 60_000; const r = rev++;
  return db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: 'NEARUSDT', expected_revision: r, mode,
    checkpoint: { symbol: 'NEARUSDT', tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: o, high: hi ?? Math.max(o, c) + 0.01, low: lo ?? Math.min(o, c) - 0.01, close: c, volume: 1 }] },
    market: { symbol: 'NEARUSDT', price: c, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null }, events })]);
}
const enter = (d: Dir, mtf_trend: Trend | null = bias(d), extra: Record<string, unknown> = {}, id = 't1', mode = 'live') =>
  candle([ev('entry_confirmed', d, { ...(mtf_trend ? { mtf_trend } : {}), ...extra }, id)], 100, 100, mode);
const trades = async () => (await db.query<{ entry_price: string; stop_loss: string; take_profit: string; leverage: number; margin: string; rule_version: string; status: string; exit_reason: string | null; exit_price: string | null }>('select * from sim_trades order by created_at')).rows;
const decision = async (id = 't1') => (await db.query<{ status: string; reason: string | null }>('select status, reason from sim_breakeven_confirmations where trade_id=$1', [id])).rows[0];
const messages = async () => (await db.query<{ message: string }>('select message from telegram_logs')).rows.map((r) => r.message);

describe('prompt-43 Simulator: 1m Pine entries, trend gate, 50x, 10% margin per slot, no stop, +25% target, cross margin', () => {
  it('LONG with trend opens at 50x using 10% of balance, no Pine stop, target at +25% net', async () => {
    await enter('LONG');
    const t = (await trades())[0]!;
    expect(t.leverage).toBe(50); expect(Number(t.margin)).toBe(1); expect(t.rule_version).toBe('PINE1_CROSS');
    expect(Number(t.take_profit)).toBeCloseTo((100 * 1.0055 + 0.02) / 0.9995, 6);
    expect(Number(t.stop_loss)).toBeLessThan(82);
  });
  it('5-minute entries no longer open trades', async () => {
    await enter('LONG', bias('LONG'), { timeframe: '5' });
    expect(await trades()).toHaveLength(0);
  });
  it('prompt-42: trend filter back — 1m against the trend or 15m/5m disagreeing is skipped', async () => {
    await enter('LONG', bias('LONG', -1));
    await enter('LONG', { m15: 1, m5: -1, m1: 0 }, {}, 't2');
    expect(await trades()).toHaveLength(0);
    expect((await decision())?.reason).toBe('ONE_MINUTE_OPPOSITE');
  });
  it('prompt-45: force-closes at market exactly 24 hours after entry, then the coin can trade again', async () => {
    await enter('LONG'); // entered at the close of this candle
    minute += 86_400_000 - 120_000;
    await candle([], 99.5, 99.5, 'live', 99.6, 99.4); // closes 23h59m after entry
    expect((await trades())[0]!.status).toBe('OPEN');
    await candle([ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG') }, 't2')], 99.5, 99.4, 'live', 99.6, 99.3); // closes exactly 24h after entry
    const [first, second] = await trades();
    expect(first!.status).toBe('CLOSED'); expect(first!.exit_reason).toBe('TIME_EXIT'); expect(Number(first!.exit_price)).toBe(99.4);
    const t = (await db.query<{ pnl: string; balance_after: string; exit_fee: string }>("select pnl, balance_after, exit_fee from sim_trades where trade_id='t1'")).rows[0]!;
    // 0.5 qty: -0.3 price move, -0.01 slippage, 0.025 entry fee, 0.5*99.4*0.05% exit fee
    expect(Number(t.exit_fee)).toBeCloseTo(0.02485, 8);
    expect(Number(t.pnl)).toBeCloseTo(-0.3 - 0.01 - 0.025 - 0.02485, 8);
    expect(second!.status).toBe('OPEN');
    expect((await messages())[0]).toContain('Closed after 24 hours');
  });
  it('prompt-45: SHORT trades also close after 24 hours', async () => {
    await enter('SHORT');
    minute += 86_400_000 - 60_000;
    await candle([], 100.2, 100.2, 'live', 100.3, 100.1);
    expect((await trades())[0]!.exit_reason).toBe('TIME_EXIT');
  });
  it('prompt-44: manual close settles at the saved price and sends Closed manually', async () => {
    await enter('LONG');
    await candle([], 100, 100.2, 'live', 100.25, 99.9);
    const id = (await db.query<{ id: string }>('select id from sim_trades')).rows[0]!.id;
    await db.query('select sim_manual_close($1::uuid)', [id]);
    const t = (await trades())[0]!; expect(t.status).toBe('CLOSED'); expect(t.exit_reason).toBe('MANUAL_CLOSE'); expect(Number(t.exit_price)).toBe(100.2);
    expect((await messages())[0]).toContain('Closed manually');
    await expect(db.query('select sim_manual_close($1::uuid)', [id])).rejects.toThrow();
  });
  it('prompt-44: three trades at once on different coins, each 10% of balance; a fourth is skipped', async () => {
    await enter('LONG');
    await candle([{ ...ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG'), symbol: 'LINKUSDT' }, 't2') }]);
    await candle([{ ...ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG'), symbol: 'SUIUSDT' }, 't3') }]);
    await candle([{ ...ev('entry_confirmed', 'LONG', { mtf_trend: bias('LONG'), symbol: 'INJUSDT' }, 't4') }]);
    const open = (await trades()).filter((t) => t.status === 'OPEN');
    expect(open).toHaveLength(3); expect(open.map((t) => Number(t.margin))).toEqual([1, 1, 1]);
    expect((await decision('t4'))?.reason).toBe('ALL_SLOTS_IN_USE');
  });
  it('prompt-42: never two trades on the same coin', async () => {
    await enter('LONG'); await enter('LONG', bias('LONG'), {}, 't2');
    expect(await trades()).toHaveLength(1); expect((await decision('t2'))?.reason).toBe('COIN_ALREADY_OPEN');
  });
  it('a 5% move against the trade and a Pine stop event do not close it', async () => {
    await enter('LONG');
    await candle([ev('stop_loss_hit', 'LONG', { exit_price: 99 })], 100, 95, 'live', 100, 95);
    expect((await trades())[0]!.status).toBe('OPEN');
  });
  it('closes at +25% of margin (0.25 on 1 margin) with Take profit hit only', async () => {
    await enter('LONG');
    await candle([], 100, 101, 'live', 101, 99.9);
    const t = (await trades())[0]!; expect(t.status).toBe('CLOSED'); expect(t.exit_reason).toBe('TAKE_PROFIT');
    const bal = Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance);
    expect(bal).toBeCloseTo(10.25, 6);
    const m = await messages(); expect(m).toHaveLength(1); expect(m[0]).toContain('Take profit hit');
  });
  it('cross margin: liquidation wipes the whole balance', async () => {
    await enter('LONG');
    await candle([], 100, 75, 'live', 100, 75);
    expect((await trades())[0]!.exit_reason).toBe('LIQUIDATED');
    expect(Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance)).toBe(0);
  });
});
