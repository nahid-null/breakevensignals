// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ST_INTERVAL, ST_SYMBOLS, stSignalId, type StSide, type StSymbol } from '../lib/engine/supertrend';
import { initialStAccount, processStAccount, type StAccountState, type StBrackets, type StMinuteFrame } from '../lib/engine/st-account';
import { StBatch } from '../lib/engine/st-live';

// prompt-81 SuperTrend Simulator persistence against the real migrations in isolated PostgreSQL (never production).
const instance = '22222222-2222-4222-8222-222222222222';
const brackets = Object.fromEntries(ST_SYMBOLS.map((s) => [s, [{ floor: 0, cap: 1e9, rate: .01, cumulative: 0, maxLeverage: 75 }]])) as StBrackets;
const T0 = 1_795_000_000_000 - (1_795_000_000_000 % ST_INTERVAL);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort();
  for (const f of files) await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
  const pending = process.env['ST_PENDING_SQL'];
  if (pending && existsSync(pending) && !files.some((f) => f.includes('supertrend'))) await db.exec(await readFile(pending, 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 12, error: null })]);
  await db.exec('update app_settings set telegram_enabled=true');
});
afterEach(async () => { await db.exec('ROLLBACK'); });

const c = (time: number, p: number) => ({ time, open: p, high: p, low: p, close: p, volume: 1 });
function frame(time: number, prices: Partial<Record<StSymbol, number>> = {}, signals: { symbol: StSymbol; side: StSide }[] = []): StMinuteFrame {
  const f: StMinuteFrame = { time, last: {} as StMinuteFrame['last'], mark: {} as StMinuteFrame['mark'], funding: {}, signals: [], mode: 'live' };
  for (const s of ST_SYMBOLS) { const p = prices[s] ?? 100; f.last[s] = c(time, p); f.mark[s] = c(time, p); }
  f.signals = signals.map(({ symbol, side }) => ({ id: stSignalId(symbol, side, time - ST_INTERVAL), symbol, side, signalTime: time - ST_INTERVAL, confirmTime: time, close: p0(prices, symbol), line: 100 }));
  return f;
}
const p0 = (prices: Partial<Record<StSymbol, number>>, s: StSymbol) => prices[s] ?? 100;
const marks = Object.fromEntries(ST_SYMBOLS.map((s) => [s, 100])) as Record<StSymbol, number>;
async function commit(frames: StMinuteFrame[], state: StAccountState = initialStAccount(), revision = 0) {
  const batch = new StBatch(frames[0]!.time); let s = state;
  for (const f of frames) { const r = processStAccount(s, f, brackets); s = r.state; batch.add(r, f.mode, marks); }
  const r = await db.query<{ st_commit: { conflict: boolean; revision: number; stopped?: boolean } }>('select st_commit($1::jsonb)', [JSON.stringify(batch.payload(instance, revision, s, []))]);
  return { state: s, result: r.rows[0]!.st_commit };
}
// Minutes from T0 up to (not including) `to`, with an optional signal on the last one.
const minutes = (from: number, to: number) => Array.from({ length: (to - from) / 60_000 }, (_, i) => frame(from + i * 60_000));

describe('prompt-81 SuperTrend Simulator database commit', () => {
  it('saves a new LONG with 5% margin and 75x and queues its Telegram opening', async () => {
    const { result } = await commit([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    expect(result.conflict).toBe(false);
    const t = (await db.query<{ side: string; margin: string; leverage: number; status: string }>('select * from st_trades')).rows;
    expect(t).toHaveLength(1); expect(t[0]!.side).toBe('LONG'); expect(Number(t[0]!.margin)).toBeCloseTo(.5, 8); expect(t[0]!.leverage).toBe(75); expect(t[0]!.status).toBe('OPEN');
    const tg = (await db.query<{ event_id: string; message: string }>("select * from telegram_logs where event_id like 'ST30-%'")).rows;
    expect(tg.map((x) => x.event_id)).toEqual([`${stSignalId('NEARUSDT', 'LONG', T0 - ST_INTERVAL)}-st-open`]);
    expect(tg[0]!.message).toContain('NEARUSDT LONG');
  });

  it('reverses LONG into SHORT in the same slot: result message is queued before the new trade message', async () => {
    const first = await commit([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    const t1 = T0 + ST_INTERVAL;
    await commit([...minutes(T0 + 60_000, t1), frame(t1, { NEARUSDT: 101 }, [{ symbol: 'NEARUSDT', side: 'SHORT' }])], first.state, first.result.revision);
    const rows = (await db.query<{ trade_id: string; side: string; status: string; exit_reason: string | null; reversed_to: string | null; reversed_from: string | null; net: string | null }>('select * from st_trades order by entry_time')).rows;
    expect(rows.map((r) => `${r.side}:${r.status}`)).toEqual(['LONG:CLOSED', 'SHORT:OPEN']);
    expect(rows[0]!.exit_reason).toBe('OPPOSITE_SIGNAL'); expect(Number(rows[0]!.net)).toBeGreaterThan(0);
    expect(rows[0]!.reversed_to).toBe(rows[1]!.trade_id); expect(rows[1]!.reversed_from).toBe(rows[0]!.trade_id);
    const tg = (await db.query<{ event_id: string }>("select event_id from telegram_logs where event_id like 'ST30-%' order by created_at")).rows.map((r) => r.event_id.split('-st-')[1]);
    expect(tg).toEqual(['open', 'result', 'open']);
    const sig = (await db.query<{ decision: string }>('select decision from st_signals order by signal_time')).rows.map((r) => r.decision);
    expect(sig).toEqual(['OPENED', 'REVERSED']);
    const a = (await db.query<{ open_count: number; status: string; main_balance: string }>('select * from st_account')).rows[0]!;
    expect(a.open_count).toBe(1); expect(a.status).toBe('RUNNING'); expect(Number(a.main_balance)).toBeGreaterThan(10);
  });

  it('the database refuses a second open trade on the same coin', async () => {
    await commit([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    await expect(db.query("insert into st_trades(trade_id,symbol,side,signal_time,entry_time,entry_price,quantity,margin,entry_fee,liquidation_price) values('x','NEARUSDT','SHORT',now(),now(),1,1,1,0,0)")).rejects.toThrow();
  });

  it('refuses coins outside the five', async () => {
    await expect(db.query("insert into st_trades(trade_id,symbol,side,signal_time,entry_time,entry_price,quantity,margin,entry_fee,liquidation_price) values('y','ETHUSDT','LONG',now(),now(),1,1,1,0,0)")).rejects.toThrow();
  });

  it('a stale revision is a conflict and writes nothing', async () => {
    const first = await commit([frame(T0, {}, [{ symbol: 'NEARUSDT', side: 'LONG' }])]);
    const again = await commit([frame(T0 + 60_000)], first.state, 0);
    expect(again.result.conflict).toBe(true);
  });

  it('does not touch the stopped crypto Simulator', async () => {
    const before = (await db.query<{ n: number }>('select count(*)::int n from cstf_trades')).rows[0]!.n;
    await commit([frame(T0, {}, [{ symbol: 'WLDUSDT', side: 'SHORT' }])]);
    expect((await db.query<{ n: number }>('select count(*)::int n from cstf_trades')).rows[0]!.n).toBe(before);
  });
});
