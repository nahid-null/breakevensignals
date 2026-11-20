CREATE TABLE public.filter_backtest_runs (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  start_balance numeric NOT NULL,
  final_balance numeric NOT NULL,
  rules_sha256 text NOT NULL,
  summary jsonb NOT NULL
);
GRANT ALL ON public.filter_backtest_runs TO service_role;
ALTER TABLE public.filter_backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.filter_backtest_signals (
  run_id text NOT NULL REFERENCES public.filter_backtest_runs(id),
  signal_no integer NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL,
  signal_time timestamptz NOT NULL,
  stars integer NOT NULL,
  indicator_entry numeric NOT NULL,
  decision text NOT NULL,
  path text,
  score integer NOT NULL,
  strong_continuation boolean NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL,
  trade jsonb,
  after_signal jsonb NOT NULL,
  PRIMARY KEY (run_id, signal_no)
);
GRANT ALL ON public.filter_backtest_signals TO service_role;
ALTER TABLE public.filter_backtest_signals ENABLE ROW LEVEL SECURITY;