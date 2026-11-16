import { createServerFn } from '@tanstack/react-start';
import type { TerminalStats } from './engine/stats';

/**
 * Dashboard reads. Browsers no longer read the database directly; these run on the server,
 * which is reachable only through the private (sign-in protected) published site.
 * Read-only, fixed queries — no caller-supplied filters.
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

export const readRobotAccount = get.handler(async () => must(await (await db()).from('robot_account').select('*').eq('id', 1).single()));
export const readRobotSettings = get.handler(async () => must(await (await db()).from('robot_settings').select('*').eq('id', 1).single()));
export const readRobotPositions = get.handler(async () => must(await (await db()).from('robot_positions').select('*').order('opened_at', { ascending: false }).limit(1000)));
export const readRobotMarkets = get.handler(async () => must(await (await db()).from('robot_market').select('*').order('symbol')));
export const readRobotSignals = get.handler(async () => must(await (await db()).from('robot_signals').select('*').order('created_at', { ascending: false }).limit(100)));
export const readRobotScanner = get.handler(async () => must(await (await db()).from('robot_scanner').select('*').eq('id', 1).maybeSingle()));
export const readRobotRuntime = get.handler(async () => must(await (await db()).from('robot_runtime').select('*').eq('id', 1).maybeSingle()));
export const readRobotDecisions = get.handler(async () => must(await (await db()).from('robot_decisions').select('*').order('received_at', { ascending: false }).limit(240)));
export const readRobotBacktests = get.handler(async () => must(await (await db()).from('robot_backtests').select('*').order('created_at', { ascending: false }).limit(10)));
