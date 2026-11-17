import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

export const readSimControlAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { getRequest } = await import('@tanstack/react-start/server');
  const { simulatorControlsAllowed } = await import('./simulator-control-policy');
  return { allowed: simulatorControlsAllowed(getRequest().url) };
});

/** Adds practice money to the simulator balance. Takes effect from the next simulated trade. */
export const addSimBalance = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ amount: z.number().finite().positive().max(1_000_000_000) }).parse(d))
  .handler(async ({ data }) => {
    const { requireSimulatorControlAccess } = await import('./simulator-control.server'); requireSimulatorControlAccess();
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: r, error } = await supabaseAdmin.rpc('sim_deposit', { amount: Math.round(data.amount * 100) / 100 });
    if (error) throw new Error(error.message);
    return r as { balance: number };
  });

/** Pauses or resumes new simulated trades; an open trade still finishes. */
export const setSimEnabled = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { requireSimulatorControlAccess } = await import('./simulator-control.server'); requireSimulatorControlAccess();
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.rpc('sim_set_enabled', { on_off: data.enabled });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Audited capital adjustment; database serializes it against open trades. */
export const changeSimBalance = createServerFn({ method: 'POST' })
  .inputValidator((d: unknown) => z.object({ balance: z.number().finite().min(0).max(1_000_000_000), restart: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { requireSimulatorControlAccess } = await import('./simulator-control.server'); requireSimulatorControlAccess();
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: result, error } = await supabaseAdmin.rpc('sim_change_balance', { new_balance: data.balance, restart: data.restart });
    if (error) throw new Error(error.message);
    return result as { balance: number };
  });
