// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CSTF_SYMBOLS } from '../lib/engine/cstf';
import { initialCstfAccount, processCstfAccount, type Brackets, type MinuteFrame } from '../lib/engine/cstf-account';
import { CstfBatch } from '../lib/engine/cstf-live';
import type { CstfSymbol } from '../lib/engine/cstf';

// prompt-74 CSTF Simulator persistence against the real migrations in isolated PostgreSQL (never production).
const instance = '11111111-1111-4111-8111-111111111111';
const brackets = Object.fromEntries(CSTF_SYMBOLS.map((s) => [s, [{ floor: 0, cap: 1e9, rate: .004, cumulative: 0, maxLeverage: 150 }]])) as Brackets;
const T0 = 1_795_000_000_000 - (1_795_000_000_000 % 1_800_000);
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  const dir = new URL('../../drizzle/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && f !== '0001_migration.sql').sort();
  for (const f of files) await db.exec((await readFile(new URL(f, dir), 'utf8')).replace(/^ALTER PUBLICATION.*$/gm, ''));
  const pending = process.env['CSTF_PENDING_SQL'];
  if (pending && existsSync(pending) && !files.some((f) => f.includes('cstf'))) await db.exec(await readFile(pending, 'utf8'));
}, 60000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  await db.query('select engine_heartbeat($1::jsonb)', [JSON.stringify({ instance_id: instance, status: 'RUNNING', websocket_connected: true, binance_connected: true, available_symbols: 12, error: null })]);
  await db.exec('update app_settings set telegram_enabled=true');
});
afterEach(async () => { await db.exec('ROLLBACK'); });

const c = (time: number, o: number, h: number, l: number, cl: number) => ({ time, open: o, high: h, low: l, close: cl, volume: 1 });
function frame(time: number, eth?: { high: number; low: number }, signals: MinuteFrame['signals'] = []): MinuteFrame {
  const f: MinuteFrame = { time, last: {} as MinuteFrame['last'], mark: {} as MinuteFrame['mark'], funding: {}, signals, mode: 'live' };
  for (const s of CSTF_SYMBOLS) { f.last[s] = c(time, 100, 100.01, 99.99, 100); f.mark[s] = c(time, 100, 100.01, 99.99, 100); }
  if (eth) { f.last.ETHUSDT = c(time, 100, eth.high, eth.low, 100); f.mark.ETHUSDT = c(time, 100, Math.min(eth.high, 100.01), Math.max(eth.low, 99.99), 100); }
  return f;
}
const sig = (side: 'LONG' | 'SHORT', bar = T0 - 1_800_000) => ({ id: `CSTF30-ETHUSDT-${side}-${bar}`, symbol: 'ETHUSDT' as CstfSymbol, side, pattern: 'Hammer', signalTime: bar, confirmTime: bar + 1_800_000, close: 100, atr: 1 });
const marks = Object.fromEntries(CSTF_SYMBOLS.map((s) => [s, 100])) as Record<CstfSymbol, number>;
async function commit(frames: MinuteFrame[], state = initialCstfAccount(), revision = 0) {
  const batch = new CstfBatch(frames[0]!.time); let s = state;
  for (const f of frames) { const r = processCstfAccount(s, f, brackets); s = r.state; batch.add(r, f.mode, marks); }
  const r = await db.query<{ cstf_commit: { conflict: boolean; revision: number } }>('select cstf_commit($1::jsonb)', [JSON.stringify(batch.payload(instance, revision, s))]);
  return { state: s, result: r.rows[0]!.cstf_commit };
}
const account = async () => (await db.query<{ wallet: string; open_count: number; revision: string; status: string; last_minute: string }>('select * from cstf_account')).rows[0]!;
const trades = async () => (await db.query<{ signal_id: string; status: string; exit_reason: string | null; net: string | null; margin: string; leverage: number }>('select * from cstf_trades')).rows;

describe('prompt-74 CSTF Simulator database commit', () => {
  it('starts at $10 and opens a 75x trade with $0.50 margin from a confirmed signal', async () => {
    expect(Number((await account()).wallet)).toBe(10);
    const { result } = await commit([frame(T0, undefined, [sig('LONG')])]);
    expect(result).toEqual({ conflict: false, revision: 1 });
    const [t] = await trades(); expect(t?.status).toBe('OPEN'); expect(Number(t?.margin)).toBeCloseTo(.5, 10); expect(t?.leverage).toBe(75);
    expect((await account()).open_count).toBe(1);
  });
  it('closes at take profit with exactly $0.10 net and queues one Telegram result', async () => {
    const first = await commit([frame(T0, undefined, [sig('LONG')])]);
    const target = first.state.positions[0]!.target;
    await commit([frame(T0 + 60_000, { high: target, low: 99.99 })], first.state, 1);
    const [t] = await trades(); expect(t?.exit_reason).toBe('TAKE_PROFIT'); expect(Number(t?.net)).toBeCloseTo(.10, 9);
    const logs = (await db.query<{ message: string }>("select message from telegram_logs where event_id like '%-cstf-result'")).rows;
    expect(logs).toHaveLength(1); expect(logs[0]?.message).toContain('Take profit hit');
  });
  it('prompt-75: after a take profit the main balance grows and the next trade uses 5% of it; the Telegram result shows the new balance', async () => {
    const first = await commit([frame(T0, undefined, [sig('LONG')])]);
    const tp = await commit([frame(T0 + 60_000, { high: first.state.positions[0]!.target, low: 99.99 })], first.state, 1);
    expect(Number((await account()).wallet)).toBeCloseTo(10.10, 9);
    const bar = T0; const frames: MinuteFrame[] = [];
    for (let t = T0 + 120_000; t <= bar + 1_800_000; t += 60_000) frames.push(frame(t, undefined, t === bar + 1_800_000 ? [sig('SHORT', bar)] : []));
    await commit(frames, tp.state, 2);
    const next = (await trades()).find((t) => t.signal_id === sig('SHORT', bar).id);
    expect(next?.status).toBe('OPEN'); expect(Number(next?.margin)).toBeCloseTo(10.10 * .05, 9);
    const old = (await trades()).find((t) => t.signal_id === sig('LONG').id); expect(Number(old?.margin)).toBeCloseTo(.50, 10);
    const log = (await db.query<{ message: string }>("select message from telegram_logs where event_id like '%-cstf-result'")).rows[0];
    expect(log?.message).toContain('Wallet: $10.1000'); expect(log?.message).toContain('Net P&L: +$0.1000');
  });
  it('rejects a stale revision without changing the account', async () => {
    await commit([frame(T0, undefined, [sig('LONG')])]);
    const again = await commit([frame(T0 + 60_000)], initialCstfAccount(), 0);
    expect(again.result.conflict).toBe(true); expect(Number((await account()).revision)).toBe(1);
  });
  it('refuses a duplicate trade for the same signal', async () => {
    const first = await commit([frame(T0, undefined, [sig('LONG')])]);
    const dup = structuredClone(first.state); dup.lastMinute = T0 - 60_000; dup.positions = [];
    await expect(commit([{ ...frame(T0, undefined, [sig('LONG')]), time: T0 }], dup, 1)).rejects.toThrow();
  });
  it('refuses skipped minutes', async () => {
    const first = await commit([frame(T0)]);
    const gap = structuredClone(first.state); gap.lastMinute = T0 + 60_000;
    await expect(commit([frame(T0 + 120_000)], gap, 1)).rejects.toThrow(/out of order/);
  });
  it('requires the worker lease', async () => {
    await db.exec("update engine_control set lease_until=now()-interval '1 minute'");
    await expect(commit([frame(T0)])).rejects.toThrow(/lease/);
  });
});
