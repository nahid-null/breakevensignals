-- Fix: the commit function's local rejection list shared a name with the scanner's rejected counter column.
CREATE OR REPLACE FUNCTION public.robot_commit(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE acct public.robot_account; cfg public.robot_settings; m jsonb; u jsonb; o jsonb; msg jsonb; sig jsonb; sc jsonb;
 applied text[] := '{}'; conflicts text[] := '{}'; opened text[] := '{}'; v_rejected jsonb := '[]'; used numeric; n_open integer; reason text;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id = 1 AND instance_id = (p->>'instance_id')::uuid AND lease_until > now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease not held'; END IF;
 IF EXISTS (SELECT 1 FROM public.engine_health WHERE id = 1 AND (error LIKE 'BINANCE_ACCESS_RESTRICTED:%' OR error LIKE 'BINANCE_IP_BANNED:%')) THEN
  RETURN jsonb_build_object('paused', true); END IF;
 SELECT * INTO acct FROM public.robot_account WHERE id = 1 FOR UPDATE;
 SELECT * INTO cfg FROM public.robot_settings WHERE id = 1;
 FOR m IN SELECT * FROM jsonb_array_elements(coalesce(p->'markets', '[]')) LOOP
  INSERT INTO public.robot_market(symbol, price, spread_bps, depth_usd, imbalance, quote_volume_24h, trend_1h, trend_15m, status, liquidity, best_direction, best_score, note,
   note_long, note_short, score_long, score_short, last_candle_at, updated_at)
  VALUES (m->>'symbol', (m->>'price')::numeric, (m->>'spread_bps')::numeric, (m->>'depth_usd')::numeric, (m->>'imbalance')::numeric, (m->>'quote_volume_24h')::numeric,
   (m->>'trend_1h')::integer, (m->>'trend_15m')::integer, coalesce(m->>'status', 'LIVE'), m->>'liquidity', m->>'best_direction', (m->>'best_score')::integer, m->>'note',
   m->>'note_long', m->>'note_short', (m->>'score_long')::integer, (m->>'score_short')::integer, (m->>'last_candle_at')::timestamptz, now())
  ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, spread_bps = EXCLUDED.spread_bps, depth_usd = EXCLUDED.depth_usd, imbalance = EXCLUDED.imbalance,
   quote_volume_24h = EXCLUDED.quote_volume_24h, trend_1h = EXCLUDED.trend_1h, trend_15m = EXCLUDED.trend_15m, status = EXCLUDED.status, liquidity = EXCLUDED.liquidity,
   best_direction = EXCLUDED.best_direction, best_score = EXCLUDED.best_score, note = EXCLUDED.note, note_long = EXCLUDED.note_long, note_short = EXCLUDED.note_short,
   score_long = EXCLUDED.score_long, score_short = EXCLUDED.score_short, last_candle_at = EXCLUDED.last_candle_at, updated_at = now();
 END LOOP;
 -- Position updates apply only against the expected version, so a retry or an emergency close is never applied twice. Stops only tighten.
 FOR u IN SELECT * FROM jsonb_array_elements(coalesce(p->'updates', '[]')) LOOP
  UPDATE public.robot_positions SET status = u->>'status', quantity_open = (u->>'quantity_open')::numeric, margin = (u->>'margin')::numeric,
   stop_loss = CASE WHEN direction = 'LONG' THEN greatest(stop_loss, (u->>'stop_loss')::numeric) ELSE least(stop_loss, (u->>'stop_loss')::numeric) END,
   tp1 = coalesce((u->>'tp')::numeric, tp1), tp2 = coalesce((u->>'tp')::numeric, tp2), funding = coalesce((u->>'funding')::numeric, funding),
   tp1_done = (u->>'tp1_done')::boolean, fees = (u->>'fees')::numeric, realized_pnl = (u->>'realized_pnl')::numeric, net_roi_pct = (u->>'net_roi_pct')::numeric,
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
   WHEN (o->>'leverage')::integer <> 50 THEN 'Leverage must be exactly 50x'
   WHEN n_open >= cfg.max_concurrent THEN 'All position slots in use'
   WHEN used + (o->>'margin')::numeric > (acct.balance + (o->>'realized_pnl')::numeric) * least(cfg.max_allocation_pct, 70) / 100 THEN 'Margin allocation cap'
   WHEN EXISTS (SELECT 1 FROM public.robot_positions WHERE status = 'OPEN' AND symbol = o->>'symbol') THEN 'Already in this coin'
   WHEN EXISTS (SELECT 1 FROM public.robot_positions WHERE id = o->>'id') THEN 'Duplicate'
   ELSE NULL END;
  IF reason IS NOT NULL THEN v_rejected := v_rejected || jsonb_build_object('id', o->>'id', 'reason', reason); CONTINUE; END IF;
  INSERT INTO public.robot_positions(id, symbol, direction, status, setup, score, leverage, band, entry_price, quantity, quantity_open, margin, notional,
   stop_loss, initial_stop, tp1, tp2, liquidation_price, risk_usdt, fees, realized_pnl, last_price, liquidity, opened_at, last_candle_time, version,
   entry_fee, requested_quantity, fill_status, target_roi_pct, tick_size)
  VALUES (o->>'id', o->>'symbol', o->>'direction', 'OPEN', o->>'setup', (o->>'score')::integer, (o->>'leverage')::integer, o->>'band',
   (o->>'entry_price')::numeric, (o->>'quantity')::numeric, (o->>'quantity')::numeric, (o->>'margin')::numeric, (o->>'notional')::numeric,
   (o->>'stop_loss')::numeric, (o->>'stop_loss')::numeric, (o->>'tp1')::numeric, (o->>'tp2')::numeric, (o->>'liquidation_price')::numeric,
   (o->>'risk_usdt')::numeric, (o->>'fees')::numeric, (o->>'realized_pnl')::numeric, (o->>'entry_price')::numeric, o->>'liquidity',
   (o->>'opened_at')::timestamptz, (o->>'last_candle_time')::bigint, 1, coalesce((o->>'entry_fee')::numeric, (o->>'fees')::numeric),
   (o->>'requested_quantity')::numeric, coalesce(o->>'fill_status', 'FILLED'), (o->>'target_roi_pct')::numeric, (o->>'tick_size')::numeric);
  UPDATE public.robot_account SET balance = greatest(0, balance + (o->>'realized_pnl')::numeric), updated_at = now() WHERE id = 1;
  UPDATE public.robot_scanner SET orders_filled = orders_filled + 1 WHERE id = 1;
  opened := opened || (o->>'id');
  PERFORM public.robot_queue_telegram((o->>'id') || '-open', o->>'id', o->>'symbol', o->>'direction', o->>'message');
 END LOOP;
 FOR sig IN SELECT * FROM jsonb_array_elements(coalesce(p->'signals', '[]')) LOOP
  INSERT INTO public.robot_signals(symbol, direction, setup, score, parts, entry_price, stop_loss, tp1, tp2, liquidity, decision, reason, candle_time)
  VALUES (sig->>'symbol', sig->>'direction', sig->>'setup', (sig->>'score')::integer, coalesce(sig->'parts', '{}'), (sig->>'entry_price')::numeric,
   (sig->>'stop_loss')::numeric, (sig->>'tp1')::numeric, (sig->>'tp2')::numeric, sig->>'liquidity',
   CASE WHEN sig->>'decision' = 'TAKEN' AND NOT EXISTS (SELECT 1 FROM public.robot_positions WHERE id = sig->>'id') THEN 'SKIPPED' ELSE sig->>'decision' END,
   coalesce((SELECT r->>'reason' FROM jsonb_array_elements(v_rejected) r WHERE r->>'id' = sig->>'id'), sig->>'reason'), (sig->>'candle_time')::timestamptz)
  ON CONFLICT (symbol, direction, candle_time) DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason
   WHERE public.robot_signals.decision <> 'TAKEN';
 END LOOP;
 sc := p->'scanner';
 IF sc IS NOT NULL THEN
  UPDATE public.robot_scanner SET monitored = coalesce((sc->>'monitored')::integer, monitored), live_feeds = coalesce((sc->>'live_feeds')::integer, live_feeds),
   last_candle_at = coalesce((sc->>'last_candle_at')::timestamptz, last_candle_at), queue = coalesce(sc->'queue', queue),
   evaluated = evaluated + coalesce((sc->'counts'->>'evaluated')::bigint, 0), long_candidates = long_candidates + coalesce((sc->'counts'->>'long_candidates')::bigint, 0),
   short_candidates = short_candidates + coalesce((sc->'counts'->>'short_candidates')::bigint, 0), rejected = rejected + coalesce((sc->'counts'->>'rejected')::bigint, 0),
   qualified = qualified + coalesce((sc->'counts'->>'qualified')::bigint, 0), orders_submitted = orders_submitted + coalesce((sc->'counts'->>'orders_submitted')::bigint, 0),
   orders_partial = orders_partial + coalesce((sc->'counts'->>'orders_partial')::bigint, 0), orders_rejected = orders_rejected + coalesce((sc->'counts'->>'orders_rejected')::bigint, 0),
   reasons = public.robot_add_counts(reasons, sc->'reasons'), exec_failures = public.robot_add_counts(exec_failures, sc->'exec_failures'),
   setups = public.robot_add_counts(setups, sc->'setups'), updated_at = now() WHERE id = 1;
 END IF;
 RETURN jsonb_build_object('paused', false, 'applied', to_jsonb(applied), 'conflicts', to_jsonb(conflicts), 'opened', to_jsonb(opened), 'rejected', v_rejected);
END $$;

REVOKE ALL ON FUNCTION public.robot_commit(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.robot_commit(jsonb) TO service_role;