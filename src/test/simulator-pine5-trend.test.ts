// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

// prompt-39 rule against the real migrations in isolated PostgreSQL (never production).
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
  symbol: 'NEARUSDT', direction, indicator: direction === 'LONG' ? 'PRO SCALPER' : 'PRO SCALPER SHORT', timeframe: '5', entry_price: 100,
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

describe('prompt-39 Simulator: 5-minute Pine entries traded only with the Trend Identify bias', () => {
  it('restart restores a 10 USDT balance', async () => {
    expect(Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance)).toBe(10);
  });
  it('LONG with 15m+5m bullish and 1m sideways opens at the indicator entry, stop and take profit, 25x, 50% margin', async () => {
    await enter('LONG');
    const t = (await trades())[0]!;
    expect(Number(t.entry_price)).toBe(100); expect(Number(t.stop_loss)).toBe(99); expect(Number(t.take_profit)).toBe(101.5);
    expect(t.leverage).toBe(25); expect(Number(t.margin)).toBe(5); expect(t.rule_version).toBe('PINE5_TREND');
    expect((await decision())?.status).toBe('CONFIRMED');
  });
  it('SHORT with 15m+5m bearish opens', async () => {
    await enter('SHORT');
    const t = (await trades())[0]!; expect(Number(t.stop_loss)).toBe(101); expect(Number(t.take_profit)).toBe(98.5);
  });
  it('1m in the same direction is allowed', async () => {
    await enter('LONG', bias('LONG', 1));
    expect(await trades()).toHaveLength(1);
  });
  it('1m against the trend is skipped', async () => {
    await enter('LONG', bias('LONG', -1));
    expect(await trades()).toHaveLength(0); expect(await decision()).toEqual({ status: 'SKIPPED', reason: 'ONE_MINUTE_OPPOSITE' });
  });
  it('a LONG signal on a bearish coin is skipped', async () => {
    await enter('LONG', bias('SHORT'));
    expect(await trades()).toHaveLength(0); expect((await decision())?.reason).toBe('BIAS_OPPOSITE_SIGNAL');
  });
  it('15m and 5m disagreeing is skipped', async () => {
    await enter('LONG', { m15: 1, m5: 0, m1: 0 });
    expect((await decision())?.reason).toBe('NO_15M_5M_BIAS');
  });
  it('a missing trend reading is skipped', async () => {
    await enter('LONG', null);
    expect((await decision())?.reason).toBe('TREND_UNKNOWN');
  });
  it('only one trade at a time', async () => {
    await enter('LONG'); await enter('LONG', bias('LONG'), {}, 't2');
    expect(await trades()).toHaveLength(1); expect((await decision('t2'))?.reason).toBe('TRADE_ALREADY_OPEN');
  });
  it('one-minute Pine entries and breakeven events never open a trade', async () => {
    await candle([ev('entry_confirmed', 'LONG', { timeframe: '1', mtf_trend: bias('LONG') })]);
    await candle([ev('breakeven_activated', 'LONG', { timeframe: '1', stop_loss: 100, mtf_trend: bias('LONG') })]);
    expect(await trades()).toHaveLength(0);
  });
  it('adopted history and recovery-time entries are not traded', async () => {
    await enter('LONG', bias('LONG'), { adopted: true });
    await enter('LONG', bias('LONG'), {}, 't2', 'recovery');
    expect(await trades()).toHaveLength(0); expect((await decision('t2'))?.reason).toBe('NOT_LIVE');
  });
  it('closes at the indicator take profit and sends only the result, labelled Take profit hit', async () => {
    await enter('LONG');
    await candle([ev('take_profit_hit', 'LONG', { exit_price: 101.5, net_result_r: 1.4 })], 101, 101.6);
    const t = (await trades())[0]!;
    expect(t.status).toBe('CLOSED'); expect(t.exit_reason).toBe('TAKE_PROFIT'); expect(Number(t.exit_price)).toBe(101.5);
    const sent = await messages();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain('Status: Take profit hit');
  });
  it('a stop at the breakeven line is reported as Stop loss hit, with no breakeven alert', async () => {
    await enter('LONG');
    await candle([ev('breakeven_activated', 'LONG', { stop_loss: 100 })], 100.5, 101);
    await candle([ev('stop_loss_hit', 'LONG', { stop_loss: 100, exit_price: 100, net_result_r: -0.1 })], 100.5, 99.9);
    expect((await trades())[0]?.exit_reason).toBe('BREAKEVEN');
    const sent = await messages();
    expect(sent).toHaveLength(1); expect(sent[0]).toContain('Status: Stop loss hit');
  });
  it('liquidates only when the indicator stop lies beyond the 25x liquidation price', async () => {
    // 25x LONG liquidation = 100 * (1 - (0.04 - 0.005)) = 96.5
    await enter('LONG', bias('LONG'), { stop_loss: 99 });
    await candle([], 100, 97, 'live', 100, 96);
    expect((await trades())[0]?.status).toBe('OPEN');
    await db.exec("update sim_trades set status='CLOSED'");
    await enter('LONG', bias('LONG'), { stop_loss: 96 }, 't3');
    await candle([], 100, 97, 'live', 100, 96.4);
    expect((await trades()).at(-1)?.exit_reason).toBe('LIQUIDATED');
  });
});
