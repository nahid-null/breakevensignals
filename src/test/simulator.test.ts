// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

// Isolated PostgreSQL only: simulator rules are checked against the real migrations, never production rows.
const instance = '11111111-1111-4111-8111-111111111111';
const dir = new URL('../../drizzle/migrations/', import.meta.url);
let db: PGlite; let revision: Record<string, number>; let minute: number;

async function migrate() {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort();
  for (const f of files) await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null })]);
  revision = {}; minute = 60_000;
}
const ev = (event: string, trade: string, extra: Record<string, unknown> = {}) => ({ event, event_id: `${trade}-${event}`, trade_id: trade,
  symbol: 'NEARUSDT', direction: 'LONG', indicator: 'PRO LONG SCALPER', timeframe: '1', entry_price: 100,
  stop_loss: 99, take_profit: 101.5, timestamp: new Date(minute + 60_000).toISOString(), fee_rate_percent: 0.04, trend_aligned: true, ...extra });
async function candle(events: unknown[], low = 99.5, high = 100.5, symbol = 'NEARUSDT', mode = 'live') {
  minute += 60_000;
  const rev = revision[symbol] ?? 0; revision[symbol] = rev + 1;
  await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol, expected_revision: rev, mode,
    checkpoint: { symbol, lastTime: minute, candles: [{ time: minute, open: 100, high, low, close: 100, volume: 1 }] },
    market: { symbol, price: 100, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null },
    events })]);
}
const balance = async () => Number((await db.query<{ b: string }>('select balance b from sim_account')).rows[0]?.b);
const trade = async (id: string) => (await db.query<Record<string, string>>('select * from sim_trades where trade_id=$1', [id])).rows[0];

describe('simulator trading (isolated PostgreSQL)', () => {
  beforeEach(migrate, 30000);
  afterEach(async () => { await db.close(); });

  it('uses 80% of the balance as margin and 50x leverage for a STRONG signal', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1', { signal_strength: 'STRONG' })]);
    const t = await trade('t1');
    expect(Number(t!.margin)).toBe(800);
    expect(t!.leverage).toBe(50);
    expect(Number(t!.notional)).toBe(40000);
    expect(Number(t!.entry_fee)).toBeCloseTo(20, 8); // 0.05% of notional
  });

  it('uses 20x leverage for a NORMAL signal and when strength is missing', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1', { signal_strength: 'NORMAL' })]);
    expect((await trade('t1'))!.leverage).toBe(20);
    await migrate(); await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't2')]);
    expect((await trade('t2'))!.leverage).toBe(20);
  });

  it('never opens a second trade while one is running', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1')]);
    await candle([ev('entry_confirmed', 't2', { symbol: 'LINKUSDT', direction: 'LONG' })], 99.5, 100.5, 'LINKUSDT');
    expect(await trade('t2')).toBeUndefined();
    expect((await db.query<{ n: number }>("select count(*)::int n from sim_trades where status='OPEN'")).rows[0]?.n).toBe(1);
  });

  it('closes at take profit with both fees deducted from the balance', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1')]); // 20x: margin 800, notional 16000, qty 160
    await candle([ev('take_profit_hit', 't1', { exit_price: 101.5, net_result_r: 1.5 })]);
    const t = await trade('t1');
    // gross 160 * 1.5 = 240; fees 8 + 8.12
    expect(Number(t!.pnl)).toBeCloseTo(240 - 8 - 8.12, 8);
    expect(t!.exit_reason).toBe('TAKE_PROFIT');
    expect(await balance()).toBeCloseTo(1000 + 240 - 16.12, 8);
  });

  it('labels a stop after breakeven as BREAKEVEN', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1')]);
    await candle([ev('breakeven_activated', 't1', { stop_loss: 100 })]);
    await candle([ev('stop_loss_hit', 't1', { stop_loss: 100, exit_price: 100, net_result_r: 0 })]);
    expect((await trade('t1'))!.exit_reason).toBe('BREAKEVEN');
  });

  it('liquidates a 50x LONG when price reaches the liquidation level before the stop', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1', { signal_strength: 'STRONG', stop_loss: 97 })]);
    const liq = Number((await trade('t1'))!.liquidation_price);
    expect(liq).toBeCloseTo(100 * (1 - 1 / 50 + 0.005), 8);
    await candle([ev('stop_loss_hit', 't1', { stop_loss: 97, exit_price: 97, net_result_r: -1 })], 96.9, 100);
    const t = await trade('t1');
    expect(t!.exit_reason).toBe('LIQUIDATED');
    expect(await balance()).toBeCloseTo(1000 - 800 - 40, 8); // margin and entry fee lost
  });

  it('ignores signals that were not trend-approved, recovery signals, and a paused simulator', async () => {
    await db.query('select sim_deposit(1000)');
    await candle([ev('entry_confirmed', 't1', { trend_aligned: false })]);
    await candle([ev('entry_confirmed', 't2')], 99.5, 100.5, 'NEARUSDT', 'recovery');
    await db.query('select sim_set_enabled(false)');
    await candle([ev('entry_confirmed', 't3')]);
    expect((await db.query<{ n: number }>('select count(*)::int n from sim_trades')).rows[0]?.n).toBe(0);
  });

  it('does not trade without a balance', async () => {
    await candle([ev('entry_confirmed', 't1')]);
    expect(await trade('t1')).toBeUndefined();
  });
});
