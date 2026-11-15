ALTER TABLE public.active_positions ADD COLUMN source text NOT NULL DEFAULT 'legacy', ADD COLUMN net_result_r numeric;
ALTER TABLE public.signal_events ADD COLUMN source text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.app_settings ADD COLUMN long_notifications_enabled boolean NOT NULL DEFAULT true, ADD COLUMN short_notifications_enabled boolean NOT NULL DEFAULT true, ADD COLUMN long_entry_enabled boolean NOT NULL DEFAULT false, ADD COLUMN short_entry_enabled boolean NOT NULL DEFAULT false, ADD COLUMN long_stop_loss_enabled boolean NOT NULL DEFAULT false, ADD COLUMN short_stop_loss_enabled boolean NOT NULL DEFAULT false, ADD COLUMN long_take_profit_enabled boolean NOT NULL DEFAULT false, ADD COLUMN short_take_profit_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.telegram_logs ADD COLUMN delivery_claim uuid, ADD COLUMN claimed_at timestamptz, ADD COLUMN next_retry_at timestamptz, ADD COLUMN delivery_uncertain boolean NOT NULL DEFAULT false;
CREATE TABLE public.engine_checkpoints (symbol text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0, last_candle_time bigint, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.engine_checkpoints TO service_role;
ALTER TABLE public.engine_checkpoints ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.engine_control (id integer PRIMARY KEY CHECK(id=1), instance_id uuid NOT NULL, lease_until timestamptz NOT NULL);
GRANT ALL ON public.engine_control TO service_role;
ALTER TABLE public.engine_control ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.market_state (symbol text PRIMARY KEY, price numeric, trend text NOT NULL DEFAULT 'WAITING', status text NOT NULL DEFAULT 'WARMING UP', last_candle_at timestamptz, long_score integer NOT NULL DEFAULT 0, short_score integer NOT NULL DEFAULT 0, error text, updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.market_state TO anon, authenticated;
GRANT ALL ON public.market_state TO service_role;
ALTER TABLE public.market_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read market state" ON public.market_state FOR SELECT TO anon,authenticated USING(true);
CREATE TABLE public.engine_health (id integer PRIMARY KEY CHECK(id=1), instance_id uuid NOT NULL, websocket_connected boolean NOT NULL DEFAULT false, binance_connected boolean NOT NULL DEFAULT false, available_symbols integer NOT NULL DEFAULT 0, status text NOT NULL, error text, last_heartbeat_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.engine_health TO anon,authenticated;
GRANT ALL ON public.engine_health TO service_role;
ALTER TABLE public.engine_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read engine health" ON public.engine_health FOR SELECT TO anon,authenticated USING(true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_state, public.engine_health;
COMMENT ON TABLE public.webhook_receipts IS 'DEPRECATED: legacy TradingView receipt history, retained without new writes.';
CREATE OR REPLACE FUNCTION public.engine_heartbeat(p jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid := (p->>'instance_id')::uuid; acquired boolean;
BEGIN
 INSERT INTO public.engine_control(id,instance_id,lease_until) VALUES(1,owner_id,now()+interval '90 seconds')
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,lease_until=EXCLUDED.lease_until WHERE engine_control.instance_id=owner_id OR engine_control.lease_until<now();
 acquired := FOUND;
 IF NOT acquired THEN RETURN false; END IF;
 INSERT INTO public.engine_health(id,instance_id,websocket_connected,binance_connected,available_symbols,status,error) VALUES(1,owner_id,(p->>'websocket_connected')::boolean,(p->>'binance_connected')::boolean,(p->>'available_symbols')::integer,p->>'status',p->>'error')
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,websocket_connected=EXCLUDED.websocket_connected,binance_connected=EXCLUDED.binance_connected,available_symbols=EXCLUDED.available_symbols,status=EXCLUDED.status,error=EXCLUDED.error,last_heartbeat_at=now();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.engine_heartbeat(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engine_heartbeat(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.process_signal_event(p jsonb, tg_message text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event text:=p->>'event'; v_trade text:=p->>'trade_id'; v_dir text:=p->>'direction'; v_ts timestamptz:=(p->>'timestamp')::timestamptz; v_pos public.active_positions%ROWTYPE; v_status text:='processed'; v_note text; v_settings public.app_settings%ROWTYPE; v_log_id uuid; notify boolean:=false;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext(v_trade));
 IF EXISTS(SELECT 1 FROM public.signal_events WHERE event_id=p->>'event_id') THEN RETURN jsonb_build_object('duplicate',true); END IF;
 SELECT * INTO v_pos FROM public.active_positions WHERE trade_id=v_trade FOR UPDATE;
 IF v_event='entry_confirmed' THEN
  IF FOUND THEN v_status:='stale';v_note:='Trade already exists';
  ELSE
   INSERT INTO public.active_positions(trade_id,symbol,direction,indicator_name,timeframe,entry_price,original_stop_loss,current_stop_loss,take_profit,fee_rate_percent,status,entry_timestamp,source)
   VALUES(v_trade,p->>'symbol',v_dir,p->>'indicator',p->>'timeframe',(p->>'entry_price')::numeric,(p->>'stop_loss')::numeric,(p->>'stop_loss')::numeric,(p->>'take_profit')::numeric,NULLIF(p->>'fee_rate_percent','')::numeric,'ACTIVE',v_ts,coalesce(p->>'source','legacy'));
  END IF;
 ELSIF NOT FOUND THEN v_status:='unmatched';v_note:='No position with this trade_id';
 ELSIF v_pos.symbol<>p->>'symbol' OR v_pos.direction<>v_dir THEN v_status:='stale';v_note:='Trade symbol or direction mismatch';
 ELSIF v_pos.status NOT IN('ACTIVE','BREAKEVEN') THEN v_status:='stale';v_note:='Position already closed';
 ELSIF v_ts<v_pos.entry_timestamp THEN v_status:='stale';v_note:='Event predates entry';
 ELSIF v_event='breakeven_activated' THEN
  IF v_pos.status='BREAKEVEN' THEN v_status:='stale';v_note:='Breakeven already active';
  ELSE UPDATE public.active_positions SET status='BREAKEVEN',current_stop_loss=(p->>'stop_loss')::numeric,breakeven_timestamp=v_ts,updated_at=now() WHERE id=v_pos.id; END IF;
 ELSIF v_event IN('stop_loss_hit','take_profit_hit') THEN
  UPDATE public.active_positions SET status=CASE WHEN v_event='stop_loss_hit' THEN 'STOP_LOSS_HIT' ELSE 'TAKE_PROFIT_HIT' END,exit_price=NULLIF(p->>'exit_price','')::numeric,exit_timestamp=v_ts,net_result_r=NULLIF(p->>'net_result_r','')::numeric,updated_at=now() WHERE id=v_pos.id;
 ELSE RAISE EXCEPTION 'Unsupported signal event'; END IF;
 INSERT INTO public.signal_events(event_id,trade_id,symbol,direction,event_type,indicator_name,timeframe,entry_price,stop_loss,take_profit,exit_price,fee_rate_percent,"timestamp",processed_status,processing_note,source)
 VALUES(p->>'event_id',v_trade,p->>'symbol',v_dir,v_event,p->>'indicator',p->>'timeframe',NULLIF(p->>'entry_price','')::numeric,NULLIF(p->>'stop_loss','')::numeric,NULLIF(p->>'take_profit','')::numeric,NULLIF(p->>'exit_price','')::numeric,NULLIF(p->>'fee_rate_percent','')::numeric,v_ts,v_status,v_note,coalesce(p->>'source','legacy'));
 IF v_status='processed' AND tg_message<>'' THEN
  SELECT * INTO v_settings FROM public.app_settings WHERE id=1;
  IF v_settings.telegram_enabled AND ((v_dir='LONG' AND v_settings.long_notifications_enabled) OR(v_dir='SHORT' AND v_settings.short_notifications_enabled)) THEN
   notify:=CASE v_event
    WHEN 'breakeven_activated' THEN CASE WHEN v_dir='LONG' THEN v_settings.long_breakeven_enabled ELSE v_settings.short_breakeven_enabled END
    WHEN 'entry_confirmed' THEN CASE WHEN v_dir='LONG' THEN v_settings.long_entry_enabled ELSE v_settings.short_entry_enabled END
    WHEN 'stop_loss_hit' THEN CASE WHEN v_dir='LONG' THEN v_settings.long_stop_loss_enabled ELSE v_settings.short_stop_loss_enabled END
    WHEN 'take_profit_hit' THEN CASE WHEN v_dir='LONG' THEN v_settings.long_take_profit_enabled ELSE v_settings.short_take_profit_enabled END ELSE false END;
   IF notify THEN INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message) VALUES(p->>'event_id',v_trade,p->>'symbol',v_dir,tg_message) ON CONFLICT(event_id) DO NOTHING RETURNING id INTO v_log_id; END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('duplicate',false,'status',v_status,'note',v_note,'telegram_log_id',v_log_id);
END $$;
REVOKE ALL ON FUNCTION public.process_signal_event(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_signal_event(jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint; current_time bigint; new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint; e jsonb; result jsonb; m jsonb:=p->'market';
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,current_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;
 current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision); END IF;
 IF current_time IS NOT NULL AND new_time<=current_time THEN RAISE EXCEPTION 'Out of order candle'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  result:=public.process_signal_event((e-'telegram_message')||jsonb_build_object('source','native'),coalesce(e->>'telegram_message',''));
  IF coalesce(result->>'status','processed')<>'processed' THEN RAISE EXCEPTION 'Engine state mismatch: %',result->>'note'; END IF;
 END LOOP;
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error')
 ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.claim_telegram_delivery(log_id uuid, claim_id uuid) RETURNS SETOF public.telegram_logs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 RETURN QUERY UPDATE public.telegram_logs SET delivery_claim=claim_id,claimed_at=now(),retry_count=retry_count+1,updated_at=now() WHERE id=log_id AND delivery_status<>'SENT' AND delivery_claim IS NULL AND NOT delivery_uncertain AND (next_retry_at IS NULL OR next_retry_at<=now()) RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_telegram_delivery(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_telegram_delivery(uuid,uuid) TO service_role;