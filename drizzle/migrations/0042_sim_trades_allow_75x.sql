ALTER TABLE public.sim_trades DROP CONSTRAINT sim_trades_leverage_check;
ALTER TABLE public.sim_trades ADD CONSTRAINT sim_trades_leverage_check CHECK (leverage >= 1 AND leverage <= 75);