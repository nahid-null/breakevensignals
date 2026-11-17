ALTER TABLE public.sim_breakeven_confirmations ADD COLUMN IF NOT EXISTS rule_version text, ADD COLUMN IF NOT EXISTS take_profit numeric;
ALTER TABLE public.sim_account ALTER COLUMN balance SET DEFAULT 10;

CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE current_revision bigint;saved_candle_time bigint;new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint;e jsonb;result jsonb;m jsonb:=p->'market';provenance text:=CASE p->>'mode' WHEN 'live' THEN 'native' WHEN 'warmup' THEN 'historical' ELSE 'recovery' END;scan_increment integer:=CASE WHEN p->>'mode' IN ('live','recovery') THEN 1 ELSE 0 END;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired';END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,saved_candle_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision);END IF;
 IF saved_candle_time IS NOT NULL AND new_time<=saved_candle_time THEN RAISE EXCEPTION 'Out of order candle';END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
 -- prompt-39: signal events never queue Telegram; only Simulator results do. Adopted history stays historical.
 result:=public.process_signal_event((e-'telegram_message')||jsonb_build_object('source',CASE WHEN coalesce((e->>'adopted')::boolean,false) THEN 'historical' ELSE provenance END),'');
 IF coalesce(result->>'status','processed')<>'processed' THEN RAISE EXCEPTION 'Engine state mismatch: %',result->>'note';END IF;END LOOP;
 PERFORM public.simulate_engine_candle(p);
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error,successful_scans,mtf_trend) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error',scan_increment,NULLIF(m->'mtf_trend','null'::jsonb)) ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,successful_scans=market_state.successful_scans+scan_increment,mtf_trend=EXCLUDED.mtf_trend,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $function$;

CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;s integer;px numeric;why text;m numeric;q numeric;fee numeric;slip numeric;liq numeric;ct bigint:=(c->>'time')::bigint;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;t15 integer;t5 integer;t1 integer;pe numeric;
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
  IF t.rule_version IN ('PINE_NET10','PINE_BE_CONFIRM','PINE_BE_TREND') THEN
   IF liq_hit AND (NOT stop_hit OR (s=1 AND t.stop_loss<t.liquidation_price) OR(s=-1 AND t.stop_loss>t.liquidation_price)) THEN px:=t.liquidation_price;why:='LIQUIDATED';
   ELSIF stop_hit THEN px:=t.stop_loss;why:=CASE WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END;
   ELSIF tp_hit THEN px:=t.take_profit;why:='TAKE_PROFIT';END IF;
  ELSIF t.rule_version='PINE5_TREND' THEN
   -- Price reaches a nearer Pine stop before liquidation; liquidation applies only when the stop lies beyond it.
   IF liq_hit AND ((s=1 AND t.stop_loss<t.liquidation_price) OR (s=-1 AND t.stop_loss>t.liquidation_price)) THEN px:=t.liquidation_price;why:='LIQUIDATED';
   ELSE FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
    IF e->>'trade_id'=t.trade_id AND e->>'event' IN ('stop_loss_hit','take_profit_hit') THEN px:=(e->>'exit_price')::numeric;why:=CASE WHEN e->>'event'='take_profit_hit' THEN 'TAKE_PROFIT' WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END;END IF;
   END LOOP;END IF;
  ELSE
   IF liq_hit AND (NOT stop_hit OR(s=1 AND t.stop_loss<t.liquidation_price) OR(s=-1 AND t.stop_loss>t.liquidation_price)) THEN px:=t.liquidation_price;why:='LIQUIDATED';
   ELSE FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
    IF e->>'trade_id'=t.trade_id AND e->>'event' IN ('stop_loss_hit','take_profit_hit') THEN px:=(e->>'exit_price')::numeric;why:=CASE WHEN e->>'event'='take_profit_hit' THEN 'TAKE_PROFIT' WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END;END IF;
   END LOOP;END IF;
  END IF;
  IF px IS NOT NULL THEN PERFORM public.sim_finish_trade(t.id,px,why,ts,t.rule_version='PINE5_TREND' OR p->>'mode'='live');END IF;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  IF coalesce((e->>'adopted')::boolean,false) THEN CONTINUE;END IF;
  IF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN' AND rule_version NOT IN ('PINE_BE_CONFIRM','PINE_BE_TREND');
  END IF;
  -- prompt-39: original Pine entries from 5-minute bars, traded only with the Trend Identify bias.
  IF e->>'event'='entry_confirmed' AND e->>'timeframe'='5' AND NOT EXISTS(SELECT 1 FROM public.sim_trades WHERE trade_id=e->>'trade_id') AND NOT EXISTS(SELECT 1 FROM public.sim_breakeven_confirmations WHERE trade_id=e->>'trade_id') THEN
   s:=CASE WHEN e->>'direction'='LONG' THEN 1 ELSE -1 END;
   t15:=(e->'mtf_trend'->>'m15')::integer;t5:=(e->'mtf_trend'->>'m5')::integer;t1:=(e->'mtf_trend'->>'m1')::integer;
   pe:=(e->>'entry_price')::numeric;
   SELECT * INTO a FROM public.sim_account WHERE id=1;
   m:=round(a.balance*0.5,8);
   why:=CASE WHEN p->>'mode'<>'live' THEN 'NOT_LIVE'
    WHEN t15 IS NULL OR t5 IS NULL OR t1 IS NULL THEN 'TREND_UNKNOWN'
    WHEN t15=0 OR t15<>t5 THEN 'NO_15M_5M_BIAS'
    WHEN t15<>s THEN 'BIAS_OPPOSITE_SIGNAL'
    WHEN t1=-s THEN 'ONE_MINUTE_OPPOSITE'
    WHEN NOT a.enabled THEN 'SIMULATOR_OFF' WHEN m<=0 THEN 'NO_BALANCE'
    WHEN EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN 'TRADE_ALREADY_OPEN' ELSE NULL END;
   IF why IS NULL THEN
    q:=m*25/pe;fee:=m*25*0.0005;slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);
    liq:=pe*(1-s*(1.0/25-0.005));
    INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct,breakeven)
    VALUES(e->>'trade_id',e->>'symbol',e->>'direction','NORMAL',25,m,m*25,q,pe,(e->>'stop_loss')::numeric,(e->>'take_profit')::numeric,liq,ct,fee,a.balance,ts,'PINE5_TREND',slip,NULL,false) ON CONFLICT(trade_id) DO NOTHING;
   END IF;
   INSERT INTO public.sim_breakeven_confirmations(trade_id,symbol,direction,reference_price,breakeven_stop,breakeven_candle_time,status,reason,decided_at,mtf_trend,entry_price,take_profit,rule_version)
   VALUES(e->>'trade_id',e->>'symbol',e->>'direction',pe,(e->>'stop_loss')::numeric,ct,CASE WHEN why IS NULL THEN 'CONFIRMED' ELSE 'SKIPPED' END,why,now(),e->'mtf_trend',pe,(e->>'take_profit')::numeric,'PINE5_TREND') ON CONFLICT(trade_id) DO NOTHING;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sim_finish_trade(trade_uuid uuid, px numeric, reason text, ts timestamp with time zone, notify_result boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
 'SIMULATOR — TRADE RESULT'||chr(10)||'Status: '||CASE WHEN reason='TAKE_PROFIT' THEN 'Take profit hit' ELSE 'Stop loss hit' END||CASE WHEN reason='LIQUIDATED' THEN ' (liquidated first)' ELSE '' END||chr(10)||t.symbol||' '||t.direction||' · '||t.leverage||'x'||chr(10)||'Entry: '||round(t.entry_price,8)||chr(10)||'Take profit: '||round(t.take_profit,8)||chr(10)||'Stop loss: '||round(t.stop_loss,8)||chr(10)||'Exit: '||round(px,8)||chr(10)||'Margin: '||round(t.margin,8)||' USDT'||chr(10)||'Net P&L: '||round(net,8)||' USDT'||chr(10)||'Balance: '||round(nb,8)||' USDT'||chr(10)||'Time: '||ts::text||chr(10)||'Practice money only; fees and modeled slippage included.') ON CONFLICT(event_id) DO NOTHING;
 END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.sim_change_balance(new_balance numeric, restart boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE a public.sim_account; nb numeric;
BEGIN
 IF new_balance IS NULL OR new_balance<0 OR new_balance>1000000000 THEN RAISE EXCEPTION 'Invalid balance'; END IF;
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Simulator account missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN RAISE EXCEPTION 'Wait for the open practice trade to finish before changing the balance'; END IF;
 nb:=CASE WHEN restart THEN 10 ELSE round(new_balance,2) END;
 INSERT INTO public.sim_balance_events(kind,balance_before,balance_after) VALUES(CASE WHEN restart THEN 'RESET' ELSE 'EDIT' END,a.balance,nb);
 UPDATE public.sim_account SET balance=nb,enabled=CASE WHEN restart THEN true ELSE enabled END,session_started_at=CASE WHEN restart THEN clock_timestamp() ELSE session_started_at END,updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('balance',nb);
END $function$;