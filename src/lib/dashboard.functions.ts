import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { TerminalStats } from './engine/stats';
import type { Json } from '@/integrations/supabase/types';

/**
 * Dashboard reads. Browsers no longer read the database directly; these run on the server,
 * which is reachable only through the private (sign-in protected) published site.
 * Read-only, fixed queries; the chart reads take only a validated coin symbol and a bounded time window.
 */
async function db() {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  return supabaseAdmin;
}
function must<R>(r: { data: R; error: { message: string } | null }): R {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
const get = createServerFn({ method: 'GET' });

export const readPositions = get.handler(async () => must(await (await db()).from('active_positions').select('*').order('entry_timestamp', { ascending: false }).limit(1000)));
export const readEvents = get.handler(async () => must(await (await db()).from('signal_events').select('*').order('timestamp', { ascending: false }).limit(1000)));
export const readTelegramLogs = get.handler(async () => must(await (await db()).from('telegram_logs').select('*').order('created_at', { ascending: false }).limit(500)));
export const readSettings = get.handler(async () => must(await (await db()).from('app_settings').select('*').eq('id', 1).single()));
export const readMarkets = get.handler(async () => must(await (await db()).from('market_state').select('*')));
export const readStats = get.handler(async () => {
  const { data, error } = await (await db()).rpc('terminal_statistics');
  if (error) throw new Error(error.message);
  return JSON.parse(JSON.stringify(data)) as TerminalStats;
});

export const readSimAccount = get.handler(async () => must(await (await db()).from('sim_account').select('*').eq('id', 1).maybeSingle()));
export const readSimTrades = get.handler(async () => must(await (await db()).from('sim_trades').select('*').order('opened_at', { ascending: false }).limit(500)) ?? []);

/** Simulator breakeven decisions (traded or skipped with reason and 15M/5M/1M trend), newest first. */
export const readSimDecisions = get.handler(async () => must(await (await db()).from('sim_breakeven_confirmations').select('*').order('created_at', { ascending: false }).limit(200)) ?? []);

export const readRobotAccount = get.handler(async () => must(await (await db()).from('robot_account').select('*').eq('id', 1).single()));
export const readRobotSettings = get.handler(async () => must(await (await db()).from('robot_settings').select('*').eq('id', 1).single()));
export const readRobotPositions = get.handler(async () => must(await (await db()).from('robot_positions').select('*').order('opened_at', { ascending: false }).limit(1000)));
export const readRobotMarkets = get.handler(async () => must(await (await db()).from('robot_market').select('*').order('symbol')));
export const readRobotSignals = get.handler(async () => must(await (await db()).from('robot_signals').select('*').order('created_at', { ascending: false }).limit(100)));
export const readRobotScanner = get.handler(async () => must(await (await db()).from('robot_scanner').select('*').eq('id', 1).maybeSingle()));
export const readRobotRuntime = get.handler(async () => must(await (await db()).from('robot_runtime').select('*').eq('id', 1).maybeSingle()));
export const readRobotDecisions = get.handler(async () => must(await (await db()).from('robot_decisions').select('*').order('received_at', { ascending: false }).limit(240)));
export const readRobotBacktests = get.handler(async () => must(await (await db()).from('robot_backtests').select('*').order('created_at', { ascending: false }).limit(10)));

/**
 * Chart: one coin's robot decisions in a bounded time window (newest first, max 4000 rows).
 * Read-only; the only caller inputs are a validated symbol and a window of at most 8 days.
 */
const decisionWindow = z.object({ symbol: z.string().regex(/^[A-Z0-9]{2,20}USDT$/), from: z.number().int().positive(), to: z.number().int().positive() })
  .refine((v) => v.to > v.from && v.to - v.from <= 8 * 86_400_000, 'Window must be positive and at most 8 days');
export const readRobotDecisionsFor = createServerFn({ method: 'GET' }).inputValidator((v: unknown) => decisionWindow.parse(v)).handler(async ({ data }) => {
  const client = await db(); const rows: { candle_time: string; direction: string; phase: string; decision: string; reason: string; score: number | null; strategy: string; evidence: Json | null }[] = [];
  for (let page = 0; page < 4; page++) {
    const r = must(await client.from('robot_decisions').select('candle_time,direction,phase,decision,reason,score,strategy,evidence')
      .eq('symbol', data.symbol).gte('candle_time', new Date(data.from).toISOString()).lte('candle_time', new Date(data.to).toISOString())
      .order('candle_time', { ascending: false }).range(page * 1000, page * 1000 + 999));
    rows.push(...(r ?? []));
    if ((r ?? []).length < 1000) break;
  }
  return rows;
});
/** Chart: one coin's Pine-engine signal events (live worker history), newest first. */
export const readSignalEventsFor = createServerFn({ method: 'GET' }).inputValidator((v: unknown) => z.object({ symbol: z.string().regex(/^[A-Z0-9]{2,20}USDT$/) }).parse(v))
  .handler(async ({ data }) => must(await (await db()).from('signal_events').select('event_type,direction,timestamp,entry_price,stop_loss,take_profit,exit_price,trade_id,source')
    .eq('symbol', data.symbol).order('timestamp', { ascending: false }).limit(1000)));

/** prompt-64: read-only scanner status for the Simulator page (version inferred from the newest entry's rule). */
export const readScannerStatus = get.handler(async () => {
  const c = await db();
  const health = must(await c.from('engine_health').select('status,last_heartbeat_at,started_at,host_kind,runtime_mode').eq('id', 1).maybeSingle());
  const latest = must(await c.from('sim_breakeven_confirmations').select('symbol,direction,entry_price,rule_version,reason,status,created_at,breakeven_candle_time').order('created_at', { ascending: false }).limit(1).maybeSingle());
  const strong = must(await c.from('sim_breakeven_confirmations').select('symbol,direction,entry_price,status,reason,signal_score,created_at,breakeven_candle_time').eq('rule_version', 'OBSTRONG5_SPOT').order('created_at', { ascending: false }).limit(1).maybeSingle());
  const version = latest === null ? 'UNKNOWN' : latest.rule_version === 'OBSTRONG5_SPOT' ? 'NEW' : 'OLD';
  return { health, latest, strong, version } as const;
});

/** prompt-68 offline Smart Filter backtest (research only): latest run summary and every stored signal. */
export const readFilterBacktest = get.handler(async () => {
  const c = await db();
  const run = must(await c.from('filter_backtest_runs').select('id,window_start,window_end,start_balance,final_balance,rules_sha256,summary,created_at').order('created_at', { ascending: false }).limit(1).maybeSingle());
  if (!run) return { run: null, signals: [] };
  const signals = must(await c.from('filter_backtest_signals').select('signal_no,symbol,direction,signal_time,stars,indicator_entry,decision,path,score,strong_continuation,reasons,trade,after_signal').eq('run_id', run.id).order('signal_no'));
  return { run, signals: signals ?? [] };
});

/** prompt-74 CSTF 30m Simulator (shared $10 cross account): account snapshot, trades and recent signal decisions. */
export const readCstfSimulator = get.handler(async () => {
  const c = await db();
  const account = must(await c.from('cstf_account').select('wallet,equity,maintenance,open_count,status,error,started_at,checked_at,last_minute,updated_at').eq('id', 1).maybeSingle());
  const trades = must(await c.from('cstf_trades').select('signal_id,symbol,side,pattern,signal_time,entry_time,entry_price,quantity,margin,leverage,entry_fee,target,liquidation_price,funding,mark_price,unrealized,status,exit_reason,exit_time,exit_price,exit_fee,net,wallet_after,closed_mode').order('entry_time', { ascending: false }).limit(500)) ?? [];
  const signals = must(await c.from('cstf_signals').select('signal_id,symbol,side,pattern,signal_time,decision,reason,mode').order('signal_time', { ascending: false }).limit(100)) ?? [];
  return { account: account ? { ...account, last_minute: account.last_minute === null ? null : Number(account.last_minute) } : null, trades, signals };
});
