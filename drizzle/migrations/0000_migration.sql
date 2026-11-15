-- Positions
CREATE TABLE public.active_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id text NOT NULL UNIQUE,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG','SHORT')),
  indicator_name text NOT NULL,
  timeframe text NOT NULL,
  entry_price numeric NOT NULL,
  original_stop_loss numeric NOT NULL,
  current_stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  fee_rate_percent numeric,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BREAKEVEN','STOP_LOSS_HIT','TAKE_PROFIT_HIT')),
  entry_timestamp timestamptz NOT NULL,
  breakeven_timestamp timestamptz,
  exit_timestamp timestamptz,
  exit_price numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_positions_symbol_dir ON public.active_positions (symbol, direction, entry_timestamp DESC);
GRANT SELECT ON public.active_positions TO anon, authenticated;
GRANT ALL ON public.active_positions TO service_role;
ALTER TABLE public.active_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read positions" ON public.active_positions FOR SELECT TO anon, authenticated USING (true);

-- Events
CREATE TABLE public.signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  trade_id text NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG','SHORT')),
  event_type text NOT NULL CHECK (event_type IN ('entry_confirmed','breakeven_activated','stop_loss_hit','take_profit_hit')),
  indicator_name text NOT NULL,
  timeframe text NOT NULL,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  exit_price numeric,
  fee_rate_percent numeric,
  "timestamp" timestamptz NOT NULL,
  processed_status text NOT NULL CHECK (processed_status IN ('processed','unmatched','stale')),
  processing_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_ts ON public.signal_events ("timestamp" DESC);
CREATE INDEX idx_events_trade ON public.signal_events (trade_id);
GRANT SELECT ON public.signal_events TO anon, authenticated;
GRANT ALL ON public.signal_events TO service_role;
ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read events" ON public.signal_events FOR SELECT TO anon, authenticated USING (true);

-- Raw webhook receipts (private)
CREATE TABLE public.webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text,
  accepted boolean NOT NULL,
  reason text,
  raw_payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_receipts_time ON public.webhook_receipts (received_at DESC);
GRANT ALL ON public.webhook_receipts TO service_role;
ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;

-- Telegram logs
CREATE TABLE public.telegram_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  trade_id text,
  symbol text,
  direction text,
  is_test boolean NOT NULL DEFAULT false,
  message text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING','SENT','FAILED')),
  telegram_message_id bigint,
  error_message text,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tg_created ON public.telegram_logs (created_at DESC);
GRANT SELECT ON public.telegram_logs TO anon, authenticated;
GRANT ALL ON public.telegram_logs TO service_role;
ALTER TABLE public.telegram_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read telegram logs" ON public.telegram_logs FOR SELECT TO anon, authenticated USING (true);

-- Settings (single row)
CREATE TABLE public.app_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  telegram_enabled boolean NOT NULL DEFAULT true,
  long_breakeven_enabled boolean NOT NULL DEFAULT true,
  short_breakeven_enabled boolean NOT NULL DEFAULT true,
  display_timezone text NOT NULL DEFAULT 'UTC',
  default_fee_rate_percent numeric NOT NULL DEFAULT 0.04,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_settings (id) VALUES (1);
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read settings" ON public.app_settings FOR SELECT TO anon, authenticated USING (true);

-- Atomic event processing. Returns telegram log id if a breakeven notification must be sent.
CREATE OR REPLACE FUNCTION public.process_signal_event(p jsonb, tg_message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text := p->>'event';
  v_trade text := p->>'trade_id';
  v_dir text := p->>'direction';
  v_ts timestamptz := (p->>'timestamp')::timestamptz;
  v_pos public.active_positions%ROWTYPE;
  v_status text := 'processed';
  v_note text;
  v_settings public.app_settings%ROWTYPE;
  v_log_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.signal_events WHERE event_id = p->>'event_id') THEN
    RETURN jsonb_build_object('duplicate', true);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_trade));
  SELECT * INTO v_pos FROM public.active_positions WHERE trade_id = v_trade FOR UPDATE;

  IF v_event = 'entry_confirmed' THEN
    IF FOUND THEN
      v_status := 'stale'; v_note := 'Trade already exists';
    ELSE
      INSERT INTO public.active_positions (trade_id, symbol, direction, indicator_name, timeframe, entry_price,
        original_stop_loss, current_stop_loss, take_profit, fee_rate_percent, status, entry_timestamp)
      VALUES (v_trade, p->>'symbol', v_dir, p->>'indicator', p->>'timeframe', (p->>'entry_price')::numeric,
        (p->>'stop_loss')::numeric, (p->>'stop_loss')::numeric, (p->>'take_profit')::numeric,
        NULLIF(p->>'fee_rate_percent','')::numeric, 'ACTIVE', v_ts);
    END IF;
  ELSIF NOT FOUND THEN
    v_status := 'unmatched'; v_note := 'No position with this trade_id';
  ELSIF v_pos.status NOT IN ('ACTIVE','BREAKEVEN') THEN
    v_status := 'stale'; v_note := 'Position already closed';
  ELSIF v_event = 'breakeven_activated' THEN
    IF v_pos.status = 'BREAKEVEN' THEN
      v_status := 'stale'; v_note := 'Breakeven already active';
    ELSE
      UPDATE public.active_positions SET status = 'BREAKEVEN', current_stop_loss = (p->>'stop_loss')::numeric,
        breakeven_timestamp = v_ts, updated_at = now() WHERE id = v_pos.id;
    END IF;
  ELSE
    UPDATE public.active_positions SET
      status = CASE WHEN v_event = 'stop_loss_hit' THEN 'STOP_LOSS_HIT' ELSE 'TAKE_PROFIT_HIT' END,
      exit_price = NULLIF(p->>'exit_price','')::numeric, exit_timestamp = v_ts, updated_at = now()
    WHERE id = v_pos.id;
  END IF;

  INSERT INTO public.signal_events (event_id, trade_id, symbol, direction, event_type, indicator_name, timeframe,
    entry_price, stop_loss, take_profit, exit_price, fee_rate_percent, "timestamp", processed_status, processing_note)
  VALUES (p->>'event_id', v_trade, p->>'symbol', v_dir, v_event, p->>'indicator', p->>'timeframe',
    NULLIF(p->>'entry_price','')::numeric, NULLIF(p->>'stop_loss','')::numeric, NULLIF(p->>'take_profit','')::numeric,
    NULLIF(p->>'exit_price','')::numeric, NULLIF(p->>'fee_rate_percent','')::numeric, v_ts, v_status, v_note);

  -- Telegram is ONLY for breakeven_activated, enforced here.
  IF v_event = 'breakeven_activated' AND v_status = 'processed' THEN
    SELECT * INTO v_settings FROM public.app_settings WHERE id = 1;
    IF v_settings.telegram_enabled AND
       ((v_dir = 'LONG' AND v_settings.long_breakeven_enabled) OR (v_dir = 'SHORT' AND v_settings.short_breakeven_enabled)) THEN
      INSERT INTO public.telegram_logs (event_id, trade_id, symbol, direction, message)
      VALUES (p->>'event_id', v_trade, p->>'symbol', v_dir, tg_message)
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id INTO v_log_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('duplicate', false, 'status', v_status, 'note', v_note, 'telegram_log_id', v_log_id);
END;
$$;
REVOKE ALL ON FUNCTION public.process_signal_event(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_signal_event(jsonb, text) TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.active_positions, public.signal_events, public.telegram_logs, public.app_settings;