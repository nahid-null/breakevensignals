-- Paper-trading robot. All writes go through SECURITY DEFINER functions called by server code.
ALTER TABLE public.engine_health DROP CONSTRAINT IF EXISTS engine_health_scanned_symbols_check;
ALTER TABLE public.engine_health ADD CONSTRAINT engine_health_scanned_symbols_check CHECK (scanned_symbols >= 0 AND scanned_symbols <= 60);

CREATE TABLE public.robot_settings (
 id integer PRIMARY KEY CHECK (id = 1),
 enabled boolean NOT NULL DEFAULT true, emergency_stop boolean NOT NULL DEFAULT false,
 min_score integer NOT NULL DEFAULT 75 CHECK (min_score BETWEEN 50 AND 100),
 high_score integer NOT NULL DEFAULT 85 CHECK (high_score BETWEEN 50 AND 100),
 risk_per_trade_pct numeric NOT NULL DEFAULT 0.5 CHECK (risk_per_trade_pct > 0 AND risk_per_trade_pct <= 2),
 max_concurrent integer NOT NULL DEFAULT 3 CHECK (max_concurrent BETWEEN 1 AND 5),
 max_same_direction integer NOT NULL DEFAULT 2 CHECK (max_same_direction BETWEEN 1 AND 5),
 max_allocation_pct numeric NOT NULL DEFAULT 70 CHECK (max_allocation_pct > 0 AND max_allocation_pct <= 70),
 max_leverage integer NOT NULL DEFAULT 50 CHECK (max_leverage BETWEEN 1 AND 50),
 daily_loss_limit_pct numeric NOT NULL DEFAULT 3 CHECK (daily_loss_limit_pct > 0 AND daily_loss_limit_pct <= 20),
 loss_streak_cooldown integer NOT NULL DEFAULT 2 CHECK (loss_streak_cooldown BETWEEN 1 AND 10),
 cooldown_minutes integer NOT NULL DEFAULT 60 CHECK (cooldown_minutes BETWEEN 0 AND 1440),
 max_hold_minutes integer NOT NULL DEFAULT 180 CHECK (max_hold_minutes BETWEEN 10 AND 1440),
 fee_pct numeric NOT NULL DEFAULT 0.05 CHECK (fee_pct >= 0 AND fee_pct <= 1),
 slippage_bps numeric NOT NULL DEFAULT 2 CHECK (slippage_bps >= 0 AND slippage_bps <= 100),
 max_spread_bps numeric NOT NULL DEFAULT 8 CHECK (max_spread_bps > 0 AND max_spread_bps <= 100),
 min_quote_volume_musd numeric NOT NULL DEFAULT 20 CHECK (min_quote_volume_musd >= 0),
 updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.robot_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.robot_account (
 id integer PRIMARY KEY CHECK (id = 1), balance numeric NOT NULL DEFAULT 1000 CHECK (balance >= 0),
 start_balance numeric NOT NULL DEFAULT 1000, total_deposited numeric NOT NULL DEFAULT 1000, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.robot_account(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE public.robot_account_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK (kind IN ('DEPOSIT')), amount numeric NOT NULL CHECK (amount > 0),
 balance_after numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.robot_positions (
 id text PRIMARY KEY, mode text NOT NULL DEFAULT 'PAPER' CHECK (mode = 'PAPER'), symbol text NOT NULL,
 direction text NOT NULL CHECK (direction IN ('LONG','SHORT')), status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
 setup text NOT NULL, score integer NOT NULL, leverage integer NOT NULL CHECK (leverage BETWEEN 1 AND 50), band text NOT NULL,
 entry_price numeric NOT NULL CHECK (entry_price > 0), quantity numeric NOT NULL CHECK (quantity > 0), quantity_open numeric NOT NULL CHECK (quantity_open >= 0),
 margin numeric NOT NULL CHECK (margin >= 0), notional numeric NOT NULL CHECK (notional > 0),
 stop_loss numeric NOT NULL CHECK (stop_loss > 0), initial_stop numeric NOT NULL CHECK (initial_stop > 0),
 tp1 numeric NOT NULL, tp2 numeric NOT NULL, liquidation_price numeric NOT NULL, risk_usdt numeric NOT NULL CHECK (risk_usdt > 0),
 tp1_done boolean NOT NULL DEFAULT false, fees numeric NOT NULL DEFAULT 0, realized_pnl numeric NOT NULL DEFAULT 0,
 unrealized_pnl numeric NOT NULL DEFAULT 0, last_price numeric, liquidity text, opened_at timestamptz NOT NULL, closed_at timestamptz,
 exit_price numeric, exit_reason text CHECK (exit_reason IN ('TAKE_PROFIT','STOP_LOSS','BREAKEVEN_STOP','EARLY_EXIT','PROFIT_EXIT','TIME_EXIT','LIQUIDATION','EMERGENCY_STOP')),
 last_candle_time bigint NOT NULL, version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((direction = 'LONG' AND initial_stop < entry_price) OR (direction = 'SHORT' AND initial_stop > entry_price)));
CREATE UNIQUE INDEX robot_positions_one_open_per_symbol ON public.robot_positions (symbol) WHERE status = 'OPEN';
CREATE INDEX robot_positions_opened ON public.robot_positions (opened_at DESC);

CREATE TABLE public.robot_market (
 symbol text PRIMARY KEY, price numeric, spread_bps numeric, depth_usd numeric, imbalance numeric, quote_volume_24h numeric,
 trend_1h integer, trend_15m integer, status text NOT NULL DEFAULT 'WARMING UP', liquidity text, best_direction text, best_score integer,
 note text, last_candle_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE public.robot_signals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), symbol text NOT NULL, direction text NOT NULL CHECK (direction IN ('LONG','SHORT')),
 setup text NOT NULL, score integer NOT NULL, parts jsonb NOT NULL, entry_price numeric NOT NULL, stop_loss numeric NOT NULL,
 tp1 numeric NOT NULL, tp2 numeric NOT NULL, liquidity text, decision text NOT NULL CHECK (decision IN ('TAKEN','SKIPPED','REJECTED')),
 reason text, candle_time timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (symbol, direction, candle_time));
CREATE INDEX robot_signals_created ON public.robot_signals (created_at DESC);

CREATE TABLE public.robot_backtests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(), period_start timestamptz NOT NULL,
 period_end timestamptz NOT NULL, symbols text[] NOT NULL, summary jsonb NOT NULL, notes text);

GRANT SELECT ON public.robot_settings, public.robot_account, public.robot_account_events, public.robot_positions, public.robot_market, public.robot_signals, public.robot_backtests TO anon, authenticated;
GRANT ALL ON public.robot_settings, public.robot_account, public.robot_account_events, public.robot_positions, public.robot_market, public.robot_signals, public.robot_backtests TO service_role;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['robot_settings','robot_account','robot_account_events','robot_positions','robot_market','robot_signals','robot_backtests'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY "Public read %s" ON public.%I FOR SELECT TO anon, authenticated USING (true)', t, t);
 END LOOP; END $$;

CREATE OR REPLACE FUNCTION public.robot_queue_telegram(p_event text, p_trade text, p_symbol text, p_direction text, p_message text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF p_message IS NULL OR p_message = '' OR NOT coalesce((SELECT telegram_enabled FROM public.app_settings WHERE id = 1), true) THEN RETURN; END IF;
 INSERT INTO public.telegram_logs(event_id, trade_id, symbol, direction, is_test, message, delivery_status)
 VALUES (p_event, p_trade, p_symbol, p_direction, false, p_message, 'PENDING') ON CONFLICT (event_id) DO NOTHING;
END $$;

-- Atomic worker commit: markets, signal log, position updates and guarded opens in one transaction.
CREATE OR REPLACE FUNCTION public.robot_commit(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acct public.robot_account; cfg public.robot_settings; m jsonb; u jsonb; o jsonb; msg jsonb; sig jsonb;
 applied text[] := '{}'; conflicts text[] := '{}'; opened text[] := '{}'; rejected jsonb := '[]'; used numeric; n_open integer; reason text;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id = 1 AND instance_id = (p->>'instance_id')::uuid AND lease_until > now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease not held'; END IF;
 IF EXISTS (SELECT 1 FROM public.engine_health WHERE id = 1 AND (error LIKE 'BINANCE_ACCESS_RESTRICTED:%' OR error LIKE 'BINANCE_IP_BANNED:%')) THEN
  RETURN jsonb_build_object('paused', true); END IF;
 SELECT * INTO acct FROM public.robot_account WHERE id = 1 FOR UPDATE;
 SELECT * INTO cfg FROM public.robot_settings WHERE id = 1;
 FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p->'markets', '[]')) LOOP
  INSERT INTO public.robot_market(symbol, price, spread_bps, depth_usd, imbalance, quote_volume_24h, trend_1h, trend_15m, status, liquidity, best_direction, best_score, note, last_candle_at, updated_at)
  VALUES (m->>'symbol', (m->>'price')::numeric, (m->>'spread_bps')::numeric, (m->>'depth_usd')::numeric, (m->>'imbalance')::numeric, (m->>'quote_volume_24h')::numeric,
   (m->>'trend_1h')::integer, (m->>'trend_15m')::integer, coalesce(m->>'status', 'LIVE'), m->>'liquidity', m->>'best_direction', (m->>'best_score')::integer, m->>'note', (m->>'last_candle_at')::timestamptz, now())
  ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, spread_bps = EXCLUDED.spread_bps, depth_usd = EXCLUDED.depth_usd, imbalance = EXCLUDED.imbalance,
   quote_volume_24h = EXCLUDED.quote_volume_24h, trend_1h = EXCLUDED.trend_1h, trend_15m = EXCLUDED.trend_15m, status = EXCLUDED.status, liquidity = EXCLUDED.liquidity,
   best_direction = EXCLUDED.best_direction, best_score = EXCLUDED.best_score, note = EXCLUDED.note, last_candle_at = EXCLUDED.last_candle_at, updated_at = now();
 END LOOP;
 -- Position updates apply only against the expected version, so a retry or an emergency close is never applied twice.
 FOR u IN SELECT * FROM jsonb_array_elements(coalesce(p->'updates', '[]')) LOOP
  UPDATE public.robot_positions SET status = u->>'status', quantity_open = (u->>'quantity_open')::numeric, margin = (u->>'margin')::numeric,
   stop_loss = CASE WHEN direction = 'LONG' THEN greatest(stop_loss, (u->>'stop_loss')::numeric) ELSE least(stop_loss, (u->>'stop_loss')::numeric) END,
   tp1_done = (u->>'tp1_done')::boolean, fees = (u->>'fees')::numeric, realized_pnl = (u->>'realized_pnl')::numeric,
   unrealized_pnl = (u->>'unrealized_pnl')::numeric, last_price = (u->>'last_price')::numeric, closed_at = (u->>'closed_at')::timestamptz,
   exit_price = (u->>'exit_price')::numeric, exit_reason = u->>'exit_reason', last_candle_time = (u->>'last_candle_time')::bigint,
   version = (u->>'version')::integer, updated_at = now()
  WHERE id = u->>'id' AND status = 'OPEN' AND version = (u->>'expected_version')::integer;
  IF FOUND THEN
   applied := applied || (u->>'id');
   UPDATE public.robot_account SET balance = greatest(0, balance + (u->>'pnl_delta')::numeric), updated_at = now() WHERE id = 1;
   FOR msg IN SELECT * FROM jsonb_array_elements(coalesce(u->'messages', '[]')) LOOP
    PERFORM public.robot_queue_telegram(msg->>'event_id', u->>'id', msg->>'symbol', msg->>'direction', msg->>'message');
   END LOOP;
  ELSE conflicts := conflicts || (u->>'id'); END IF;
 END LOOP;
 FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'opens', '[]')) LOOP
  SELECT * INTO acct FROM public.robot_account WHERE id = 1;
  SELECT coalesce(sum(margin), 0), count(*) INTO used, n_open FROM public.robot_positions WHERE status = 'OPEN';
  reason := CASE
   WHEN cfg.emergency_stop THEN 'Emergency stop active'
   WHEN NOT cfg.enabled THEN 'Robot paused'
   WHEN n_open >= cfg.max_concurrent THEN 'Maximum open positions'
   WHEN (o->>'leverage')::integer > least(cfg.max_leverage, 50) THEN 'Leverage above limit'
   WHEN used + (o->>'margin')::numeric > acct.balance * least(cfg.max_allocation_pct, 70) / 100 THEN 'Margin allocation cap'
   WHEN EXISTS (SELECT 1 FROM public.robot_positions WHERE status = 'OPEN' AND symbol = o->>'symbol') THEN 'Already in this coin'
   WHEN EXISTS (SELECT 1 FROM public.robot_positions WHERE id = o->>'id') THEN 'Duplicate'
   ELSE NULL END;
  IF reason IS NOT NULL THEN rejected := rejected || jsonb_build_object('id', o->>'id', 'reason', reason); CONTINUE; END IF;
  INSERT INTO public.robot_positions(id, symbol, direction, status, setup, score, leverage, band, entry_price, quantity, quantity_open, margin, notional,
   stop_loss, initial_stop, tp1, tp2, liquidation_price, risk_usdt, fees, realized_pnl, last_price, liquidity, opened_at, last_candle_time, version)
  VALUES (o->>'id', o->>'symbol', o->>'direction', 'OPEN', o->>'setup', (o->>'score')::integer, (o->>'leverage')::integer, o->>'band',
   (o->>'entry_price')::numeric, (o->>'quantity')::numeric, (o->>'quantity')::numeric, (o->>'margin')::numeric, (o->>'notional')::numeric,
   (o->>'stop_loss')::numeric, (o->>'stop_loss')::numeric, (o->>'tp1')::numeric, (o->>'tp2')::numeric, (o->>'liquidation_price')::numeric,
   (o->>'risk_usdt')::numeric, (o->>'fees')::numeric, (o->>'realized_pnl')::numeric, (o->>'entry_price')::numeric, o->>'liquidity',
   (o->>'opened_at')::timestamptz, (o->>'last_candle_time')::bigint, 1);
  UPDATE public.robot_account SET balance = greatest(0, balance + (o->>'realized_pnl')::numeric), updated_at = now() WHERE id = 1;
  opened := opened || (o->>'id');
  PERFORM public.robot_queue_telegram((o->>'id') || '-open', o->>'id', o->>'symbol', o->>'direction', o->>'message');
 END LOOP;
 FOR sig IN SELECT * FROM jsonb_array_elements(coalesce(p->'signals', '[]')) LOOP
  INSERT INTO public.robot_signals(symbol, direction, setup, score, parts, entry_price, stop_loss, tp1, tp2, liquidity, decision, reason, candle_time)
  VALUES (sig->>'symbol', sig->>'direction', sig->>'setup', (sig->>'score')::integer, coalesce(sig->'parts', '{}'), (sig->>'entry_price')::numeric,
   (sig->>'stop_loss')::numeric, (sig->>'tp1')::numeric, (sig->>'tp2')::numeric, sig->>'liquidity',
   CASE WHEN sig->>'id' = ANY(opened) THEN 'TAKEN' WHEN sig->>'decision' = 'TAKEN' THEN 'SKIPPED' ELSE sig->>'decision' END,
   coalesce((SELECT r->>'reason' FROM jsonb_array_elements(rejected) r WHERE r->>'id' = sig->>'id'), sig->>'reason'), (sig->>'candle_time')::timestamptz)
  ON CONFLICT (symbol, direction, candle_time) DO NOTHING;
 END LOOP;
 RETURN jsonb_build_object('paused', false, 'applied', to_jsonb(applied), 'conflicts', to_jsonb(conflicts), 'opened', to_jsonb(opened), 'rejected', rejected);
END $$;

-- Emergency STOP ALL: halts new entries and closes every paper position at the last recorded price.
CREATE OR REPLACE FUNCTION public.robot_emergency_stop() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pos public.robot_positions; cfg public.robot_settings; px numeric; sgn integer; fee numeric; pnl numeric; n integer := 0;
BEGIN
 UPDATE public.robot_settings SET emergency_stop = true, enabled = false, updated_at = now() WHERE id = 1 RETURNING * INTO cfg;
 PERFORM 1 FROM public.robot_account WHERE id = 1 FOR UPDATE;
 FOR pos IN SELECT * FROM public.robot_positions WHERE status = 'OPEN' FOR UPDATE LOOP
  sgn := CASE WHEN pos.direction = 'LONG' THEN 1 ELSE -1 END;
  px := coalesce((SELECT price FROM public.robot_market WHERE symbol = pos.symbol), pos.last_price, pos.entry_price) * (1 - sgn * cfg.slippage_bps / 10000);
  fee := px * pos.quantity_open * cfg.fee_pct / 100;
  pnl := sgn * (px - pos.entry_price) * pos.quantity_open - fee;
  UPDATE public.robot_positions SET status = 'CLOSED', exit_reason = 'EMERGENCY_STOP', exit_price = px, closed_at = now(), quantity_open = 0, margin = 0,
   fees = fees + fee, realized_pnl = realized_pnl + pnl, unrealized_pnl = 0, version = version + 1, updated_at = now() WHERE id = pos.id;
  UPDATE public.robot_account SET balance = greatest(0, balance + pnl), updated_at = now() WHERE id = 1;
  PERFORM public.robot_queue_telegram(pos.id || '-close', pos.id, pos.symbol, pos.direction,
   '🛑 PAPER ROBOT — TRADE CLOSED (EMERGENCY STOP)' || chr(10) || pos.symbol || ' ' || pos.direction || chr(10) ||
   'Entry: ' || round(pos.entry_price, 8)::text || chr(10) || 'Exit: ' || round(px, 8)::text || chr(10) ||
   'Net PnL: ' || round(pos.realized_pnl + pnl, 2)::text || ' USDT (fees included)' || chr(10) || 'Simulated trade — no real order was placed.');
  n := n + 1;
 END LOOP;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.robot_resume() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
 UPDATE public.robot_settings SET emergency_stop = false, enabled = true, updated_at = now() WHERE id = 1;
$$;

CREATE OR REPLACE FUNCTION public.robot_deposit(amount numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b numeric;
BEGIN
 IF amount IS NULL OR amount <= 0 OR amount > 1000000000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
 UPDATE public.robot_account SET balance = balance + amount, total_deposited = total_deposited + amount, updated_at = now() WHERE id = 1 RETURNING balance INTO b;
 INSERT INTO public.robot_account_events(kind, amount, balance_after) VALUES ('DEPOSIT', amount, b);
 RETURN b;
END $$;

REVOKE ALL ON FUNCTION public.robot_queue_telegram(text, text, text, text, text), public.robot_commit(jsonb), public.robot_emergency_stop(), public.robot_resume(), public.robot_deposit(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.robot_queue_telegram(text, text, text, text, text), public.robot_commit(jsonb), public.robot_emergency_stop(), public.robot_resume(), public.robot_deposit(numeric) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.robot_positions, public.robot_market, public.robot_signals, public.robot_account, public.robot_settings;