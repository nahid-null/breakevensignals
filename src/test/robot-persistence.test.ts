// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const instance = '22222222-2222-4222-8222-222222222222';
const open = (id: string, symbol: string, margin: number, extra: Record<string, unknown> = {}) => ({ id, symbol, direction: 'LONG', setup: 'SWEEP_RECLAIM',
  score: 80, leverage: 3, band: 'Normal conditions', entry_price: 100, quantity: (margin * 3) / 100, margin, notional: margin * 3, stop_loss: 99,
  tp1: 101, tp2: 102, liquidation_price: 67, risk_usdt: 5, fees: 0.1, realized_pnl: -0.1, liquidity: 'fixture', opened_at: '2026-11-16T12:00:00Z',
  last_candle_time: 0, message: `PAPER ROBOT OPEN ${id}`, ...extra });
const commit = async (p: Record<string, unknown>) =>
  (await db.query<{ r: { paused: boolean; opened: string[]; applied: string[]; conflicts: string[]; rejected: { id: string; reason: string }[] } }>(
    'select public.robot_commit($1::jsonb) r', [JSON.stringify({ instance_id: instance, ...p })])).rows[0]!.r;
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0]!;

beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.startsWith('0001')).sort())
    await db.exec((await readFile(new URL(name, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true,
    binance_connected: true, available_symbols: 40, scanned_symbols: 40, error: null })]);
}, 60000);
afterAll(async () => { await db?.close(); });

describe('paper robot persistence (isolated PostgreSQL, no production rows)', () => {
  it('starts with a 1,000 USDT paper balance, 70% margin cap and 50x leverage ceiling', async () => {
    expect(await one('select balance::float8 b from robot_account')).toEqual({ b: 1000 });
    expect(await one('select max_allocation_pct::float8 a, max_leverage l, min_score s, high_score h from robot_settings')).toEqual({ a: 70, l: 50, s: 75, h: 85 });
  });
  it('rejects settings above 70% margin or 50x leverage', async () => {
    await expect(db.query('update robot_settings set max_allocation_pct = 71')).rejects.toThrow();
    await expect(db.query('update robot_settings set max_leverage = 51')).rejects.toThrow();
  });
  it('refuses commits from a worker that does not hold the lease', async () => {
    await expect(db.query('select robot_commit($1::jsonb)', [JSON.stringify({ instance_id: '33333333-3333-4333-8333-333333333333', opens: [open('x1', 'AUSDT', 10)] })])).rejects.toThrow(/lease/);
  });
  it('refuses a new trade that would push total margin above 70% of the balance', async () => {
    const r = await commit({ opens: [open('a', 'AUSDT', 300), open('b', 'BUSDT', 300), open('c', 'CUSDT', 300)] });
    expect(r.opened).toEqual(['a', 'b']);
    expect(r.rejected).toEqual([{ id: 'c', reason: 'Margin allocation cap' }]);
    expect(await one('select balance::float8 b from robot_account')).toEqual({ b: 999.8 });
    expect((await db.query('select event_id from telegram_logs where event_id like $1 order by event_id', ['%-open'])).rows).toEqual([{ event_id: 'a-open' }, { event_id: 'b-open' }]);
  });
  it('allows only one open paper position per coin', async () => {
    await db.query('update robot_account set balance = 100000');
    const r = await commit({ opens: [open('a2', 'AUSDT', 10)] });
    expect(r.rejected).toEqual([{ id: 'a2', reason: 'Already in this coin' }]);
    await db.query('update robot_account set balance = 999.8');
  });
  it('only ever tightens a stop and never applies the same fill twice', async () => {
    const u = { id: 'a', expected_version: 1, version: 2, status: 'OPEN', quantity_open: 9, margin: 300, stop_loss: 98, tp1_done: false, fees: 0.1,
      realized_pnl: -0.1, unrealized_pnl: 1, last_price: 100.1, closed_at: null, exit_price: null, exit_reason: null, last_candle_time: 60000, pnl_delta: 0, messages: [] };
    expect((await commit({ updates: [u] })).applied).toEqual(['a']);
    expect(await one("select stop_loss::float8 s from robot_positions where id='a'")).toEqual({ s: 99 });
    const close = { ...u, expected_version: 2, version: 3, status: 'CLOSED', quantity_open: 0, margin: 0, realized_pnl: 5, closed_at: '2026-11-16T12:30:00Z',
      exit_price: 102, exit_reason: 'TAKE_PROFIT', pnl_delta: 5.1, messages: [{ event_id: 'a-close', symbol: 'AUSDT', direction: 'LONG', message: 'PAPER ROBOT CLOSE a' }] };
    expect((await commit({ updates: [close] })).applied).toEqual(['a']);
    expect((await commit({ updates: [close] })).conflicts).toEqual(['a']);
    expect(await one('select balance::float8 b from robot_account')).toEqual({ b: 1004.9 });
  });
  it('STOP ALL closes every open paper position, blocks new entries and queues a PAPER ROBOT receipt', async () => {
    await db.query("insert into robot_market(symbol, price) values ('BUSDT', 110)");
    expect(await one('select robot_emergency_stop() n')).toEqual({ n: 1 });
    expect(await one("select status, exit_reason from robot_positions where id='b'")).toEqual({ status: 'CLOSED', exit_reason: 'EMERGENCY_STOP' });
    expect((await one<{ message: string }>("select message from telegram_logs where event_id='b-close'")).message).toMatch(/^🛑 PAPER ROBOT/);
    const r = await commit({ opens: [open('d', 'DUSDT', 10)] });
    expect(r.rejected).toEqual([{ id: 'd', reason: 'Emergency stop active' }]);
    await db.query('select robot_resume()');
    expect((await commit({ opens: [open('d', 'DUSDT', 10)] })).opened).toEqual(['d']);
  });
  it('pauses all robot writes while Binance access is restricted', async () => {
    await db.query("update engine_health set error = 'BINANCE_ACCESS_RESTRICTED: HTTP 451 /fapi/v1/klines — fixture' where id = 1");
    expect((await commit({ opens: [open('e', 'EUSDT', 10)] })).paused).toBe(true);
    expect(await one("select count(*)::int n from robot_positions where id='e'")).toEqual({ n: 0 });
    await db.query('update engine_health set error = null where id = 1');
  });
  it('does not count PAPER ROBOT receipts as sent signal alerts', async () => {
    const before = (await one<{ s: { telegramSent: number } }>('select terminal_statistics() s')).s.telegramSent;
    await db.query("update telegram_logs set delivery_status = 'SENT' where event_id in ('a-open', 'a-close', 'b-open')");
    expect((await one<{ s: { telegramSent: number } }>('select terminal_statistics() s')).s.telegramSent).toBe(before);
  });
  it('adds paper deposits to the main balance', async () => {
    const before = (await one<{ b: number }>('select balance::float8 b from robot_account')).b;
    await db.query('select robot_deposit(250)');
    expect((await one<{ b: number }>('select balance::float8 b from robot_account')).b).toBeCloseTo(before + 250, 6);
    await expect(db.query('select robot_deposit(0)')).rejects.toThrow();
  });
});
