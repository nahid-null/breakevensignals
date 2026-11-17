import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

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