// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

const instance = '11111111-1111-4111-8111-111111111111';
let db: PGlite; let revision: Record<string, number>; let minute: number;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql' && f < '0026').sort())
    await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null })]);
  await db.exec('update sim_account set balance=5;');
  revision = {}; minute = 60_000;
});
afterEach(async () => { await db.exec('ROLLBACK'); });
const ev = (event: string, trade: string, extra: Record<string, unknown> = {}) => ({ telegram_message: 'SIGNAL', event, event_id: `${trade}-${event}`, trade_id: trade,
  symbol: 'NEARUSDT', direction: 'LONG', indicator: 'PRO LONG SCALPER', timeframe: '1', entry_price: 100,
  stop_loss: 99, take_profit: 101.5, timestamp: new Date(minute + 60_000).toISOString(), fee_rate_percent: 0.04, ...extra });
async function candle(events: unknown[], low = 99.5, high = 100.1, symbol = 'NEARUSDT', mode = 'live') {
  minute += 60_000; const rev = revision[symbol] ?? 0; revision[symbol] = rev + 1;
  return db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ instance_id: instance, symbol, expected_revision: rev, mode,
    checkpoint: { symbol, tickSize: 0.01, lastTime: minute, candles: [{ time: minute, open: 100, high, low, close: 100, volume: 1 }] },
    market: { symbol, price: 100, trend: 'BULLISH', status: 'LIVE', last_candle_at: new Date(minute).toISOString(), long_score: 0, short_score: 0, error: null }, events })]);
}
type Row = { id: string; margin: string; leverage: number; notional: string; entry_fee: string; entry_price: string; pnl: string; exit_reason: string; liquidation_price: string; take_profit: string; stop_loss: string; rule_version: string; status: string };
async function trade(id: string): Promise<Row> { const row = (await db.query<Row>('select * from sim_trades where trade_id=$1', [id])).rows[0]; if (!row) throw new Error('Missing trade'); return row; }
const balance = async () => Number((await db.query<{ b: string }>('select balance b from sim_account')).rows[0]?.b);
const count = async (table: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0]?.n;

describe('previous PINE_NET10 entry rules, kept for trades opened before breakeven confirmation (isolated PostgreSQL)', () => {
  it('opens at original Pine entry before breakeven without an entry Telegram alert', async () => {
    await db.exec('update app_settings set long_entry_enabled=false');
    await candle([ev('entry_confirmed', 't1')]);
    expect(Number((await trade('t1')).entry_price)).toBe(100);
    expect(await count('telegram_logs')).toBe(0);
    expect((await trade('t1')).status).toBe('OPEN');
  });
  it('allocates exactly80% of5USDT, exactly50x and includes entry fees', async () => {
    await candle([ev('entry_confirmed', 't1', { signal_strength: 'NORMAL', trend_aligned: false })]);
    const t = await trade('t1'); expect(Number(t.margin)).toBe(4); expect(t.leverage).toBe(50);
    expect(Number(t.notional)).toBe(200); expect(Number(t.entry_fee)).toBeCloseTo(0.1, 10);
  });
  for (const direction of ['LONG','SHORT'] as const) it(`${direction}: exits at10% NET margin ROI after both fees and one tick per side`, async () => {
    await candle([ev('entry_confirmed', 't1', { direction, stop_loss: direction === 'LONG' ? 99 : 101, take_profit: direction === 'LONG' ? 101.5 : 98.5 })]);
    const tp = Number((await trade('t1')).take_profit);
    await candle([], direction === 'SHORT' ? tp : 99.9, direction === 'LONG' ? tp : 100.1);
    expect((await trade('t1')).exit_reason).toBe('TAKE_PROFIT');
    expect(Number((await trade('t1')).pnl)).toBeCloseTo(0.4, 9);
    expect(await balance()).toBeCloseTo(5.4, 9);
    expect((await db.query<{ event_id: string }>('select event_id from telegram_logs')).rows).toEqual([{ event_id: 't1-simulator-result' }]);
  });
  it('does not retrospectively trade a breakeven-only event without the original live entry', async () => {
    await candle([ev('entry_confirmed','historical')],99.5,100.1,'NEARUSDT','recovery');
    await candle([ev('breakeven_activated','historical',{stop_loss:100})]);
    expect(await count('sim_trades')).toBe(0); expect(await count('telegram_logs')).toBe(0);
  });
  it('queues breakeven with no MTF approval and leaves original Pine target unchanged', async () => {
    await candle([ev('entry_confirmed','t1',{trend_aligned:false})]);
    await candle([ev('breakeven_activated','t1',{stop_loss:100,trend_aligned:false})],99.9,100.1);
    expect(Number((await trade('t1')).stop_loss)).toBe(100);
    expect((await db.query<{ event_id: string }>('select event_id from telegram_logs')).rows).toEqual([{event_id:'t1-breakeven_activated'}]);
    expect(Number((await db.query<{ tp: string }>("select take_profit tp from active_positions where trade_id='t1'")).rows[0]?.tp)).toBe(101.5);
  });
  it('applies a moved Pine stop on the NEXT candle, not the activation candle', async () => {
    await candle([ev('entry_confirmed','t1')]);
    await candle([ev('breakeven_activated','t1',{stop_loss:100})],99.9,100.1);
    expect((await trade('t1')).status).toBe('OPEN');
    await candle([],99.9,100.1);
    expect((await trade('t1')).exit_reason).toBe('BREAKEVEN');
    expect(Number((await trade('t1')).pnl)).toBeCloseTo(-0.24, 9);
  });
  it('keeps only one open trade and ignores paused or recovery entries', async () => {
    await candle([ev('entry_confirmed','t1')]);
    await candle([ev('entry_confirmed','t2',{symbol:'LINKUSDT'})],99.5,100.1,'LINKUSDT');
    expect(await count('sim_trades')).toBe(1);
  });
  it('never opens recovery entries or paused entries', async () => {
    await candle([ev('entry_confirmed','r')],99.5,100.1,'NEARUSDT','recovery');
    await db.query('select sim_set_enabled(false)'); await candle([ev('entry_confirmed','paused')]);
    expect(await count('sim_trades')).toBe(0);
  });
  it('keeps stop priority when target and stop touch together', async () => {
    await candle([ev('entry_confirmed','t1')]); await candle([],98.9,102);
    expect((await trade('t1')).exit_reason).toBe('STOP_LOSS');
  });
  it('liquidates before a stop beyond the50x liquidation threshold', async () => {
    await candle([ev('entry_confirmed','t1',{stop_loss:97})]); await candle([],96.9,100.1);
    expect((await trade('t1')).exit_reason).toBe('LIQUIDATED'); expect(await balance()).toBeCloseTo(0.9,9);
  });
  it('settles recovery exits but suppresses stale result notifications', async () => {
    await candle([ev('entry_confirmed','t1')]); const tp=Number((await trade('t1')).take_profit);
    await candle([],99.9,tp,'NEARUSDT','recovery'); expect((await trade('t1')).status).toBe('CLOSED'); expect(await count('telegram_logs')).toBe(0);
  });
  it('blocks balance edits and restarts while a trade is open', async () => {
    await candle([ev('entry_confirmed','t1')]);
    await db.exec('SAVEPOINT invalid'); await expect(db.query('select sim_change_balance(5,true)')).rejects.toThrow('open practice trade'); await db.exec('ROLLBACK TO invalid');
    expect(await balance()).toBe(5);
  });
  it('edits balance and restarts at exactly5USDT with an audit and retained trades/deposits', async () => {
    await db.query('select sim_deposit(2)');
    await candle([ev('entry_confirmed','t1')]); const tp=Number((await trade('t1')).take_profit); await candle([],99.9,tp);
    const deposits = await count('sim_deposits');
    await db.query('select sim_change_balance(12,false)'); expect(await balance()).toBe(12);
    await db.query('select sim_change_balance(999,true)'); expect(await balance()).toBe(5);
    expect(await count('sim_trades')).toBe(1);expect(await count('sim_deposits')).toBe(deposits);expect(await count('sim_balance_events')).toBe(2);
  });
  it('restores default enabled state only on restart and preserves lifetime deposits', async () => {
    await db.query('select sim_deposit(2)');
    await db.exec('update sim_account set enabled=false');
    await db.query('select sim_change_balance(12,false)');
    expect((await db.query<{ enabled: boolean }>('select enabled from sim_account')).rows[0]?.enabled).toBe(false);
    await db.query('select sim_change_balance(999,true)');
    const a = (await db.query<{ balance: string; enabled: boolean; total_deposited: string }>('select balance,enabled,total_deposited from sim_account')).rows[0];
    expect(Number(a?.balance)).toBe(5);
    expect(a?.enabled).toBe(true);
    expect(Number(a?.total_deposited)).toBe(2);
    expect(await count('sim_deposits')).toBe(1);
  });
  it('never fabricates a trade when the practice balance is zero', async () => {
    await db.exec('update sim_account set balance=0');await candle([ev('entry_confirmed','t1')]);expect(await count('sim_trades')).toBe(0);
  });
  it('retains old leverage and fees when an existing legacy trade closes', async () => {
    await candle([ev('entry_confirmed','t1')]);
    await db.exec("update sim_trades set rule_version='LEGACY',slippage_price=0,leverage=20,margin=4,notional=80,quantity=.8,entry_fee=.04,take_profit=101.5");
    await candle([ev('take_profit_hit','t1',{exit_price:101.5})],99.9,101.5);
    expect((await trade('t1')).leverage).toBe(20);expect(Number((await trade('t1')).pnl)).toBeCloseTo(1.1194,9);
  });
  it('rolls back settlement and result alerts when a commit hits a recorded Binance restriction', async () => {
    await candle([ev('entry_confirmed','t1')]); const tp=Number((await trade('t1')).take_profit);
    await db.query('select engine_heartbeat($1::jsonb)',[JSON.stringify({instance_id:instance,status:'ERROR',websocket_connected:false,binance_connected:false,available_symbols:20,error:'BINANCE_ACCESS_RESTRICTED: HTTP451'})]);
    await db.exec('SAVEPOINT blocked');await expect(candle([],99.9,tp)).rejects.toThrow('Binance access blocked');await db.exec('ROLLBACK TO blocked');
    expect((await trade('t1')).status).toBe('OPEN');expect(await balance()).toBe(5);expect(await count('telegram_logs')).toBe(0);
  });
  it('prevents a retained older page from resuming the retired robot', async () => {
    await db.exec('SAVEPOINT resume');await expect(db.query('select robot_resume()')).rejects.toThrow('retired');await db.exec('ROLLBACK TO resume');
    await db.exec('SAVEPOINT settings');await expect(db.exec('update robot_settings set enabled=true,emergency_stop=false')).rejects.toThrow('retired');await db.exec('ROLLBACK TO settings');
    expect(await count('robot_positions')).toBe(0);
  });
});