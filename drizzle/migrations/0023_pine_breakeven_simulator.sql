ALTER TABLE public.sim_account ALTER COLUMN balance SET DEFAULT 5;
ALTER TABLE public.sim_account ADD COLUMN session_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.sim_trades ADD COLUMN rule_version text NOT NULL DEFAULT 'LEGACY', ADD COLUMN slippage_price numeric NOT NULL DEFAULT 0, ADD COLUMN target_net_roi_pct numeric;
CREATE TABLE public.sim_balance_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('EDIT','RESET')), balance_before numeric NOT NULL, balance_after numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.sim_balance_events TO service_role;
ALTER TABLE public.sim_balance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sim_balance_events FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.sim_change_balance(new_balance numeric, restart boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.sim_account; nb numeric;
BEGIN
 IF new_balance IS NULL OR new_balance<0 OR new_balance>1000000000 THEN RAISE EXCEPTION 'Invalid balance'; END IF;
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Simulator account missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN RAISE EXCEPTION 'Wait for the open practice trade to finish before changing the balance'; END IF;
 nb:=CASE WHEN restart THEN 5 ELSE round(new_balance,2) END;
 INSERT INTO public.sim_balance_events(kind,balance_before,balance_after) VALUES(CASE WHEN restart THEN 'RESET' ELSE 'EDIT' END,a.balance,nb);
 UPDATE public.sim_account SET balance=nb,session_started_at=CASE WHEN restart THEN now() ELSE session_started_at END,updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('balance',nb);
END $$;
REVOKE ALL ON FUNCTION public.sim_change_balance(numeric,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim_change_balance(numeric,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.sim_finish_trade(trade_uuid uuid, px numeric, reason text, ts timestamptz, notify_result boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t public.sim_trades; a public.sim_account; cfg public.app_settings; s integer; gross numeric; ef numeric; net numeric; nb numeric;
BEGIN
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;
 SELECT * INTO t FROM public.sim_trades WHERE id=trade_uuid AND status='OPEN' FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 s:=CASE WHEN t.direction='LONG' THEN 1 ELSE -1 END;
 IF reason='LIQUIDATED' THEN gross:=-t.margin;ef:=0;
 ELSE gross:=greatest(t.quantity*(px-t.entry_price)*s-2*t.quantity*t.slippage_price,-t.margin);ef:=t.quantity*px*0.0005;END IF;
 nb:=greatest(a.balance+gross-t.entry_fee-ef,0);net:=nb-a.balance;
 UPDATE public.sim_trades SET status='CLOSED',exit_price=px,exit_reason=reason,exit_fee=ef,gross_pnl=gross,pnl=net,balance_after=nb,closed_at=ts WHERE id=t.id;
 UPDATE public.sim_account SET balance=nb,updated_at=now() WHERE id=1;
 SELECT * INTO cfg FROM public.app_settings WHERE id=1;
 IF notify_result AND cfg.telegram_enabled AND ((t.direction='LONG' AND cfg.long_notifications_enabled) OR(t.direction='SHORT' AND cfg.short_notifications_enabled)) THEN
 INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message) VALUES(t.trade_id||'-simulator-result',t.trade_id,t.symbol,t.direction,
 'SIMULATOR — TRADE RESULT'||chr(10)||t.symbol||' '||t.direction||' · '||t.leverage||'x'||chr(10)||'Result: '||reason||chr(10)||'Original entry: '||round(t.entry_price,8)||chr(10)||'Exit: '||round(px,8)||chr(10)||'Net P&L: '||round(net,8)||' USDT'||chr(10)||'Net margin ROI: '||round(net/nullif(t.margin,0)*100,4)||'%'||chr(10)||'Balance: '||round(nb,8)||' USDT'||chr(10)||'Time: '||ts::text||chr(10)||'Practice money only; fees and modeled slippage included.') ON CONFLICT(event_id) DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.sim_finish_trade(uuid,numeric,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim_finish_trade(uuid,numeric,text,timestamptz,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;s integer;px numeric;why text;m numeric;q numeric;entry numeric;fee numeric;slip numeric;tp numeric;liq numeric;ct bigint:=(c->>'time')::bigint;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;
BEGIN
 IF p->>'mode' NOT IN ('live','recovery') OR c IS NULL THEN RETURN;END IF;
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;IF NOT FOUND THEN RETURN;END IF;
 SELECT * INTO t FROM public.sim_trades WHERE status='OPEN' AND symbol=p->>'symbol' FOR UPDATE;
 IF FOUND AND ct>t.entry_candle_time THEN
  s:=CASE WHEN t.direction='LONG' THEN 1 ELSE -1 END;
  stop_hit:=CASE WHEN s=1 THEN lo<=t.stop_loss ELSE hi>=t.stop_loss END;
  liq_hit:=CASE WHEN s=1 THEN lo<=t.liquidation_price ELSE hi>=t.liquidation_price END;
  tp_hit:=CASE WHEN s=1 THEN hi>=t.take_profit ELSE lo<=t.take_profit END;
  px:=NULL;why:=NULL;
  IF t.rule_version='PINE_NET10' THEN
   IF liq_hit AND (NOT stop_hit OR (s=1 AND t.stop_loss<t.liquidation_price) OR(s=-1 AND t.stop_loss>t.liquidation_price)) THEN px:=t.liquidation_price;why:='LIQUIDATED';
   ELSIF stop_hit THEN px:=t.stop_loss;why:=CASE WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END;
   ELSIF tp_hit THEN px:=t.take_profit;why:='TAKE_PROFIT';END IF;
  ELSE
   IF liq_hit AND (NOT stop_hit OR(s=1 AND t.stop_loss<t.liquidation_price) OR(s=-1 AND t.stop_loss>t.liquidation_price)) THEN px:=t.liquidation_price;why:='LIQUIDATED';
   ELSE FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
    IF e->>'trade_id'=t.trade_id AND e->>'event' IN ('stop_loss_hit','take_profit_hit') THEN px:=(e->>'exit_price')::numeric;why:=CASE WHEN e->>'event'='take_profit_hit' THEN 'TAKE_PROFIT' WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END;END IF;
   END LOOP;END IF;
  END IF;
  IF px IS NOT NULL THEN PERFORM public.sim_finish_trade(t.id,px,why,ts,p->>'mode'='live');END IF;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  IF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN';
  ELSIF e->>'event'='entry_confirmed' AND p->>'mode'='live' THEN
   SELECT * INTO a FROM public.sim_account WHERE id=1;
   CONTINUE WHEN NOT a.enabled OR a.balance<=0 OR EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN');
   entry:=(e->>'entry_price')::numeric;s:=CASE WHEN e->>'direction'='LONG' THEN 1 ELSE -1 END;m:=round(a.balance*0.8,8);q:=m*50/entry;fee:=m*50*0.0005;slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);
   tp:=(entry*s+(m*0.10+fee)/q+2*slip)/(s-0.0005);
   liq:=entry*(1-s*(1.0/50-0.005));
   INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct)
   VALUES(e->>'trade_id',e->>'symbol',e->>'direction','NORMAL',50,m,m*50,q,entry,(e->>'stop_loss')::numeric,tp,liq,ct,fee,a.balance,(e->>'timestamp')::timestamptz,'PINE_NET10',slip,10) ON CONFLICT(trade_id) DO NOTHING;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint;saved_candle_time bigint;new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint;e jsonb;result jsonb;m jsonb:=p->'market';provenance text:=CASE p->>'mode' WHEN 'live' THEN 'native' WHEN 'warmup' THEN 'historical' ELSE 'recovery' END;scan_increment integer:=CASE WHEN p->>'mode' IN ('live','recovery') THEN 1 ELSE 0 END;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,saved_candle_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision);END IF;
 IF saved_candle_time IS NOT NULL AND new_time<=saved_candle_time THEN RAISE EXCEPTION 'Out of order candle';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
 result:=public.process_signal_event((e-'telegram_message')||jsonb_build_object('source',provenance),CASE WHEN provenance='native' AND e->>'event'='breakeven_activated' AND EXISTS(SELECT 1 FROM public.active_positions WHERE trade_id=e->>'trade_id' AND source='native') THEN coalesce(e->>'telegram_message','') ELSE '' END);
 IF coalesce(result->>'status','processed')<>'processed' THEN RAISE EXCEPTION 'Engine state mismatch: %',result->>'note';END IF;END LOOP;
 PERFORM public.simulate_engine_candle(p);
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error,successful_scans,mtf_trend) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error',scan_increment,NULLIF(m->'mtf_trend','null'::jsonb)) ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,successful_scans=market_state.successful_scans+scan_increment,mtf_trend=EXCLUDED.mtf_trend,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;
COMMENT ON TABLE public.robot_positions IS 'DEPRECATED active feature: Paper Robot retired by user; all financial history retained.';