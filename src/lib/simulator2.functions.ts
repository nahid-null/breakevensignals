import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

/** Fixed server-side reads; no browser database access or arbitrary filters. */
export const readSimulator2 = createServerFn({ method: 'GET' }).handler(async () => {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: account, error } = await supabaseAdmin.from('sim2_account').select('*').eq('id', 1).single();
  if (error) throw new Error('Could not load Simulator 2 account');
  const { data: trades, error: tradeError } = await supabaseAdmin.from('sim2_trades').select('*')
    .eq('session_id', account.session_id).order('closed_at', { ascending: false });
  if (tradeError) throw new Error('Could not load Simulator 2 history');
  return { account, trades: trades ?? [] };
});

export const resetSimulator2 = createServerFn({ method: 'POST' }).handler(async () => {
  const { requireSimulatorControlAccess } = await import('./simulator-control.server');
  requireSimulatorControlAccess();
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error } = await supabaseAdmin.rpc('sim2_reset');
  if (error) throw new Error('Could not reset Simulator 2');
  return { ok: true };
});

export const enableSimulator2 = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => z.object({ enabled: z.boolean() }).parse(input))
  .handler(async ({ data }) => {
    const { requireSimulatorControlAccess } = await import('./simulator-control.server');
    requireSimulatorControlAccess();
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.rpc('sim2_set_enabled', { on_off: data.enabled });
    if (error) throw new Error('Could not change Simulator 2');
    return { ok: true };
  });