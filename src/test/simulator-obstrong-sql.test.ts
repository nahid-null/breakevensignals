// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

// prompt-62/63 OB STRONG Simulator rule against the real migrations in isolated PostgreSQL (never production).
const instance = '11111111-1111-4111-8111-111111111111';
let db: PGlite; let rev: Record<string, number>; let minute: number;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort();
  for (const f of files) await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
  const pending = process.env['OBS_PENDING_SQL'];
  if (pending && existsSync(pending) && !files.some((f) => f.startsWith('0044'))) await db.exec(await readFile(pending, 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null })]);
  await db.exec("select sim_change_balance(10, true); update app_settings set telegram_enabled=true, long_notifications_enabled=true, short_notifications_enabled=true;");
  rev = {}; minute = 4 * 60_000;
});
afterEach(async () => { await db.exec('ROLLBACK'); });
type Dir = 'LONG' | 'SHORT';
type Spot = { high: number; low: number } | null;
async function candle(sym: string, entries: unknown[] = [], fut = { high: 100.01, low: 99.99 }, spot: Spot = { high: 100.01, low: 99.99 }, mode = 'live') {
  minute += 60_000; const r = rev[sym] ?? 0; rev[sym] = r + 1;
  return db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol: sym, expected_revision: r, mode,
    checkpoint: { symbol: sym, tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: 100, high: fut.high, low: fut.low, close: 100, volume: 1 }] },
    market: { symbol: sym, price: 100, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null },
    events: [], simulator_entries: entries, spot_candle: spot === null ? null : { time: minute, open: 100, close: 100, ...spot } })]);
}
const obs = (direction: Dir, id: string, symbol = 'NEARUSDT', indicator = 'OB STRONG 5m') => ({ trade_id: id, symbol, direction, indicator,
  timeframe: '5', entry_price: 100, stop_loss: direction === 'LONG' ? 99 : 101, take_profit: direction === 'LONG' ? 102 : 98, score: 5, rr: 2,
  signal_time: new Date(minute + 120_000).toISOString() });
const trades = async () => (await db.query<{ trade_id: string; symbol: string; status: string; margin: string; leverage: number; rule_version: string; exit_reason: string | null; target_net_roi_pct: string; take_profit: string }>('select * from sim_trades order by created_at, trade_id')).rows;
const decision = async (id: string) => (await db.query<{ status: string; reason: string | null }>('select status, reason from sim_breakeven_confirmations where trade_id=$1', [id])).rows[0];
const balance = async () => Number((await db.query<{ balance: string }>('select balance from sim_account')).rows[0]?.balance);

describe('prompt-63 Simulator: OB STRONG 5m, 9 coins, 7 slots x 5%, 75x, +50% target, spot prices, same coin allowed', () => {
  it('opens at the signal entry price, 75x, 5% of a $10 balance ($0.50), target +50% of margin', async () => {
    await candle('NEARUSDT', [obs('LONG', 'a')]);
    const t = (await trades())[0]!;
    expect(t.rule_version).toBe('OBSTRONG5_SPOT'); expect(t.leverage).toBe(75); expect(Number(t.margin)).toBe(0.5); expect(Number(t.target_net_roi_pct)).toBe(50);
    expect(Number(t.take_profit)).toBeCloseTo((100 * (1.0005 + 0.5 / 75) + 0.02) / 0.9995, 6);
  });
  it('allows 7 open trades, including several on the same coin; the 8th is ALL_SLOTS_IN_USE', async () => {
    const coins = ['NEARUSDT', 'NEARUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'LINKUSDT', 'ADAUSDT', 'AVAXUSDT'];
    for (const [i, c] of coins.entries()) await candle(c, [obs('LONG', `s${i}`, c)]);
    expect((await trades()).filter((t) => t.status === 'OPEN')).toHaveLength(7);
    expect((await decision('s7'))?.reason).toBe('ALL_SLOTS_IN_USE');
  });
  it('BTC, DOGE and BNB signals never trade', async () => {
    for (const c of ['BTCUSDT', 'DOGEUSDT', 'BNBUSDT']) await candle(c, [obs('LONG', `x${c}`, c)]);
    expect(await trades()).toHaveLength(0); expect((await decision('xBTCUSDT'))?.reason).toBe('COIN_NOT_APPROVED');
  });
  it('old OB + Weighted VP entries no longer open trades', async () => {
    await candle('NEARUSDT', [obs('LONG', 'old', 'NEARUSDT', 'OB + Weighted VP 5m')]);
    expect(await trades()).toHaveLength(0); expect((await decision('old'))?.reason).toBe('INDICATOR_RETIRED');
  });
  it('the target is hit on the SPOT candle, not the futures candle', async () => {
    await candle('NEARUSDT', [obs('LONG', 'a')]);
    await candle('NEARUSDT', [], { high: 101, low: 99.9 }, { high: 100.5, low: 99.9 });
    expect((await trades())[0]!.status).toBe('OPEN');
    await candle('NEARUSDT', [], { high: 100.1, low: 99.9 }, { high: 100.8, low: 99.9 });
    const t = (await trades())[0]!; expect(t.exit_reason).toBe('TAKE_PROFIT');
    expect(await balance()).toBeCloseTo(10.25, 6);
  });
  it('without a spot candle the trade is not checked against futures prices', async () => {
    await candle('NEARUSDT', [obs('LONG', 'a')]);
    await candle('NEARUSDT', [], { high: 105, low: 99.9 }, null);
    expect((await trades())[0]!.status).toBe('OPEN');
  });
  it('liquidation is checked on the spot low', async () => {
    await candle('NEARUSDT', [obs('LONG', 'a')]);
    await candle('NEARUSDT', [], { high: 100, low: 99.9 }, { high: 100, low: 50 });
    expect((await trades())[0]!.exit_reason).toBe('LIQUIDATED');
  });
  it('two trades on the same coin both close at their target', async () => {
    await candle('NEARUSDT', [obs('LONG', 'a')]); await candle('NEARUSDT', [obs('LONG', 'b')]);
    await candle('NEARUSDT', [], undefined, { high: 101, low: 99.9 });
    expect((await trades()).map((t) => t.exit_reason)).toEqual(['TAKE_PROFIT', 'TAKE_PROFIT']);
  });
});
