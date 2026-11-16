// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const instance = '11111111-1111-4111-8111-111111111111';
const p = (event: string, trade = 'fixture-trade') => ({ event, event_id: `${trade}-${event}`, trade_id: trade,
  symbol: 'NEARUSDT', direction: 'LONG', indicator: 'PRO LONG SCALPER', timeframe: '1',
  entry_price: 100, stop_loss: event === 'breakeven_activated' ? 100 : 99, take_profit: 101.5,
  timestamp: '2026-11-15T12:00:00Z', fee_rate_percent: 0.04 });
async function process(event: Record<string, unknown>, message = 'fixture') {
  return (await db.query<{ r: { duplicate: boolean; status?: string; telegram_log_id?: string | null } }>('select public.process_signal_event($1::jsonb,$2) r', [JSON.stringify(event), message])).rows[0]?.r;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  // Test copy only: the isolated database has no realtime service or publication.
  for (const name of ['0000_migration.sql','0002_independent_signal_engine.sql','0003_engine_event_provenance_and_statistics.sql','0004_fix_engine_checkpoint_time_comparison.sql','0005_engine_runtime_identity_and_graceful_stop.sql','0006_windows_pc_engine_telemetry.sql','0007_durable_successful_candle_scans.sql']) {
    const sql = (await readFile(new URL(`../../drizzle/migrations/${name}`, import.meta.url), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, '');
    await db.exec(sql);
  }
}, 30000);
afterAll(async () => { await db?.close(); });
describe('atomic persistence (isolated PostgreSQL, no production rows)', () => {
  it('preserves breakeven-only LONG/SHORT notification defaults', async () => {
    const settings = (await db.query('select telegram_enabled,long_breakeven_enabled,short_breakeven_enabled,long_entry_enabled,short_entry_enabled,long_stop_loss_enabled,short_stop_loss_enabled,long_take_profit_enabled,short_take_profit_enabled from app_settings')).rows[0];
    expect(settings).toEqual({ telegram_enabled: true, long_breakeven_enabled: true, short_breakeven_enabled: true,
      long_entry_enabled: false, short_entry_enabled: false, long_stop_loss_enabled: false, short_stop_loss_enabled: false, long_take_profit_enabled: false, short_take_profit_enabled: false });
  });
  it('deduplicates events and creates exactly one breakeven notification', async () => {
    expect((await process(p('entry_confirmed')))?.telegram_log_id).toBeNull();
    expect((await process(p('entry_confirmed')))?.duplicate).toBe(true);
    expect((await process(p('breakeven_activated')))?.telegram_log_id).toBeTruthy();
    expect((await process(p('breakeven_activated')))?.duplicate).toBe(true);
    expect((await db.query<{ n: number }>('select count(*)::int n from signal_events where trade_id=$1', ['fixture-trade'])).rows[0]?.n).toBe(2);
    expect((await db.query<{ n: number }>('select count(*)::int n from telegram_logs where trade_id=$1', ['fixture-trade'])).rows[0]?.n).toBe(1);
  });
  it('allows only one live engine owner', async () => {
    const heartbeat = { instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 20, error: null };
    expect((await db.query<{ acquired: boolean }>('select engine_heartbeat($1::jsonb) acquired',[JSON.stringify(heartbeat)])).rows[0]?.acquired).toBe(true);
    expect((await db.query<{ acquired: boolean }>('select engine_heartbeat($1::jsonb) acquired',[JSON.stringify({ ...heartbeat, instance_id: '22222222-2222-4222-8222-222222222222' })])).rows[0]?.acquired).toBe(false);
  });
  it('persists actual Windows telemetry without letting a second owner overwrite it', async () => {
    const heartbeat = { instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true,
      available_symbols: 20, error: null, host_kind: 'windows_pc', runtime_mode: 'production',
      started_at: '2026-11-15T15:20:00Z', uptime_seconds: 120, scanned_symbols: 20, last_scan_at: '2026-11-15T15:22:00Z' };
    expect((await db.query<{ acquired: boolean }>('select engine_heartbeat($1::jsonb) acquired', [JSON.stringify(heartbeat)])).rows[0]?.acquired).toBe(true);
    expect((await db.query<{ acquired: boolean }>('select engine_heartbeat($1::jsonb) acquired', [JSON.stringify({ ...heartbeat, instance_id: '22222222-2222-4222-8222-222222222222', uptime_seconds: 999 })])).rows[0]?.acquired).toBe(false);
    expect((await db.query('select host_kind,uptime_seconds::int,scanned_symbols from engine_health')).rows[0]).toEqual({ host_kind: 'windows_pc', uptime_seconds: 120, scanned_symbols: 20 });
  });
  for (const mode of ['warmup','recovery'] as const) {
    it(`${mode}: stores provenance and checkpoint together without sending historical notifications`, async () => {
      const symbol = mode === 'warmup' ? 'LINKUSDT' : 'SUIUSDT';
      const trade = `${mode}-fixture`;
      const payload = { instance_id: instance, symbol, expected_revision: 0, mode,
        checkpoint: { symbol, lastTime: 60000 }, market: { symbol, price: 100, trend: 'SIDEWAYS', status: 'RECOVERING', last_candle_at: '2026-11-15T12:00:00Z', long_score: 0, short_score: 0, error: null },
        events: [p('entry_confirmed', trade),p('breakeven_activated', trade)].map(e => ({ ...e, symbol, telegram_message: 'must not notify' })) };
      expect((await db.query<{ r: { conflict: boolean; revision: number } }>('select commit_engine_candle($1::jsonb) r',[JSON.stringify(payload)])).rows[0]?.r).toEqual({ conflict: false, revision: 1 });
      expect((await db.query<{ source: string }>('select source from active_positions where trade_id=$1',[trade])).rows[0]?.source).toBe(mode === 'warmup' ? 'historical' : 'recovery');
      expect((await db.query<{ n: number }>('select count(*)::int n from telegram_logs where trade_id=$1',[trade])).rows[0]?.n).toBe(0);
      expect((await db.query<{ r: { conflict: boolean } }>('select commit_engine_candle($1::jsonb) r',[JSON.stringify(payload)])).rows[0]?.r?.conflict).toBe(true);
    });
  }
  it('rolls back checkpoint and events together on an unmatched trade event', async () => {
    const payload = { instance_id: instance, symbol: 'XRPUSDT', expected_revision: 0, mode: 'live', checkpoint: { symbol: 'XRPUSDT', lastTime: 60000 },
      market: {}, events: [{ ...p('take_profit_hit','nonexistent'), symbol: 'XRPUSDT', exit_price: 101.5, net_result_r: 1.3994 }] };
    await expect(db.query('select commit_engine_candle($1::jsonb)',[JSON.stringify(payload)])).rejects.toThrow('Engine state mismatch');
    expect((await db.query<{ n: number }>("select count(*)::int n from engine_checkpoints where symbol='XRPUSDT'")).rows[0]?.n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from market_state where symbol='XRPUSDT' and successful_scans>0")).rows[0]?.n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int n from signal_events where trade_id='nonexistent'")).rows[0]?.n).toBe(0);
  });
  it('counts saved live/recovery candles, never warmup, duplicate requests or health reads', async () => {
    const payload = { instance_id: instance, symbol: 'LTCUSDT', expected_revision: 0, mode: 'warmup',
      checkpoint: { symbol: 'LTCUSDT', lastTime: 60000 },
      market: { symbol: 'LTCUSDT', price: 100, trend: 'SIDEWAYS', status: 'RECOVERING', last_candle_at: '2026-11-15T12:00:00Z', long_score: 0, short_score: 0, error: null }, events: [] };
    const count = async () => (await db.query<{ n: number }>("select successful_scans::int n from market_state where symbol='LTCUSDT'")).rows[0]?.n;
    await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify(payload)]);
    expect(await count()).toBe(0);
    const live = { ...payload, mode: 'live', expected_revision: 1, checkpoint: { ...payload.checkpoint, lastTime: 120000 } };
    await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify(live)]);
    await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify(live)]);
    expect(await count()).toBe(1);
    await db.query('select commit_engine_candle($1::jsonb)', [JSON.stringify({ ...live, mode: 'recovery', expected_revision: 2, checkpoint: { ...live.checkpoint, lastTime: 180000 } })]);
    expect(await count()).toBe(2);
    await db.query('select * from engine_health');
    expect(await count()).toBe(2);
  });
  it('atomically claims a Telegram log only once and blocks sent-message retries', async () => {
    const row = (await db.query<{ id: string }>("select id from telegram_logs where trade_id='fixture-trade'")).rows[0];
    if (!row) throw new Error('No notification');
    expect((await db.query('select * from claim_telegram_delivery($1,$2)',[row.id, instance])).rows).toHaveLength(1);
    expect((await db.query('select * from claim_telegram_delivery($1,$2)',[row.id, instance])).rows).toHaveLength(0);
    await db.query("update telegram_logs set delivery_status='SENT',delivery_claim=null where id=$1",[row.id]);
    expect((await db.query('select * from claim_telegram_delivery($1,$2)',[row.id, instance])).rows).toHaveLength(0);
  });
  it('keeps LONG and SHORT event notification controls separate', async () => {
    await db.exec('update app_settings set long_entry_enabled=true');
    expect((await process(p('entry_confirmed','long-enabled')))?.telegram_log_id).toBeTruthy();
    const short = { ...p('entry_confirmed','short-disabled'), direction: 'SHORT', indicator: 'PRO SHORT SCALPER', stop_loss: 101, take_profit: 98.5 };
    expect((await process(short))?.telegram_log_id).toBeNull();
  });
  it('rejects another instance shutdown and releases the real owner without deleting checkpoints', async () => {
    expect((await db.query<{ stopped: boolean }>('select stop_engine($1) stopped', ['22222222-2222-4222-8222-222222222222'])).rows[0]?.stopped).toBe(false);
    expect((await db.query<{ stopped: boolean }>('select stop_engine($1) stopped', [instance])).rows[0]?.stopped).toBe(true);
    expect((await db.query<{ status: string; websocket_connected: boolean }>('select status,websocket_connected from engine_health')).rows[0]).toMatchObject({ status: 'STOPPED', websocket_connected: false });
    expect((await db.query<{ n: number }>('select count(*)::int n from engine_checkpoints')).rows[0]?.n).toBe(3);
  });
});