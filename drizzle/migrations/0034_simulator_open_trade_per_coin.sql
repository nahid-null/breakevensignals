DROP INDEX IF EXISTS public.sim_trades_one_open;
CREATE UNIQUE INDEX sim_trades_one_open_per_symbol ON public.sim_trades(symbol) WHERE status='OPEN';