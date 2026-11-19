ALTER TABLE public.sim_trades DROP CONSTRAINT sim_trades_exit_reason_check;
ALTER TABLE public.sim_trades ADD CONSTRAINT sim_trades_exit_reason_check CHECK (exit_reason = ANY (ARRAY['TAKE_PROFIT','STOP_LOSS','BREAKEVEN','LIQUIDATED','TIME_EXIT','MANUAL_CLOSE','REPLACED_BY_SIGNAL']));
CREATE OR REPLACE FUNCTION public.sim_finish_trade(trade_uuid uuid, px numeric, reason text, ts timestamp with time zone, notify_result boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE t public.sim_trades; a public.sim_account; cfg public.app_settings; s integer; gross numeric; ef numeric; other numeric; net numeric; nb numeric;
BEGIN
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;
 SELECT * INTO t FROM public.sim_trades WHERE id=trade_uuid AND status='OPEN' FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 s:=CASE WHEN t.direction='LONG' THEN 1 ELSE -1 END;
 other:=coalesce((SELECT sum(margin) FROM public.sim_trades WHERE status='OPEN' AND id<>t.id),0);
 IF reason='LIQUIDATED' AND t.rule_version IN ('PINE1_CROSS','OBVP5_CROSS') THEN gross:=-(a.balance-other-t.entry_fee);ef:=0;
 ELSIF reason='LIQUIDATED' THEN gross:=-t.margin;ef:=0;
 ELSE gross:=greatest(t.quantity*(px-t.entry_price)*s-2*t.quantity*t.slippage_price,CASE WHEN t.rule_version IN ('PINE1_CROSS','OBVP5_CROSS') THEN -(a.balance-other-t.entry_fee) ELSE -t.margin END);ef:=t.quantity*px*0.0005;END IF;
 nb:=greatest(a.balance+gross-t.entry_fee-ef,0);net:=nb-a.balance;
 UPDATE public.sim_trades SET status='CLOSED',exit_price=px,exit_reason=reason,exit_fee=ef,gross_pnl=gross,pnl=net,balance_after=nb,closed_at=ts WHERE id=t.id;
 UPDATE public.sim_account SET balance=nb,updated_at=now() WHERE id=1;
 SELECT * INTO cfg FROM public.app_settings WHERE id=1;
 IF notify_result AND cfg.telegram_enabled AND ((t.direction='LONG' AND cfg.long_notifications_enabled) OR(t.direction='SHORT' AND cfg.short_notifications_enabled)) THEN
 INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message) VALUES(t.trade_id||'-simulator-result',t.trade_id,t.symbol,t.direction,
 'SIMULATOR — TRADE RESULT'||chr(10)||'Status: '||CASE WHEN reason='TAKE_PROFIT' THEN 'Take profit hit' WHEN reason='TIME_EXIT' THEN 'Closed after 24 hours' WHEN reason='MANUAL_CLOSE' THEN 'Closed manually' WHEN reason='REPLACED_BY_SIGNAL' THEN 'Closed in loss after 4h - replaced by new same-coin signal' ELSE 'Stop loss hit' END||CASE WHEN reason='LIQUIDATED' THEN CASE WHEN t.rule_version IN ('PINE1_CROSS','OBVP5_CROSS') THEN ' (cross margin liquidated)' ELSE ' (liquidated first)' END ELSE '' END||chr(10)||t.symbol||' '||t.direction||' · '||t.leverage||'x'||chr(10)||'Entry: '||round(t.entry_price,8)||chr(10)||'Take profit: '||round(t.take_profit,8)||chr(10)||CASE WHEN t.rule_version IN ('PINE1_CROSS','OBVP5_CROSS') THEN 'Stop loss: none (cross margin, liquidation '||round(t.liquidation_price,8)||')' ELSE 'Stop loss: '||round(t.stop_loss,8) END||chr(10)||'Exit: '||round(px,8)||chr(10)||'Margin: '||round(t.margin,8)||' USDT'||chr(10)||'Net P&L: '||round(net,8)||' USDT'||chr(10)||'Balance: '||round(nb,8)||' USDT'||chr(10)||'Time: '||ts::text||chr(10)||'Practice money only; fees and modeled slippage included.') ON CONFLICT(event_id) DO NOTHING;
 END IF;
END $function$;
REVOKE ALL ON FUNCTION public.sim_finish_trade(uuid,numeric,text,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim_finish_trade(uuid,numeric,text,timestamptz,boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;s integer;px numeric;why text;m numeric;q numeric;fee numeric;slip numeric;liq numeric;ct bigint:=(c->>'time')::bigint;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;pe numeric;tp numeric;
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
  ELSIF t.rule_version IN ('PINE1_CROSS','OBVP5_CROSS') THEN
   IF liq_hit THEN px:=t.liquidation_price;why:='LIQUIDATED';ELSIF tp_hit THEN px:=t.take_profit;why:='TAKE_PROFIT';END IF;
  ELSIF t.rule_version='PINE5_TREND' THEN
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
  IF px IS NOT NULL THEN PERFORM public.sim_finish_trade(t.id,px,why,ts,t.rule_version IN ('PINE5_TREND','PINE1_CROSS','OBVP5_CROSS') OR p->>'mode'='live');END IF;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  IF coalesce((e->>'adopted')::boolean,false) THEN CONTINUE;END IF;
  IF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN' AND rule_version NOT IN ('PINE_BE_CONFIRM','PINE_BE_TREND','PINE1_CROSS','OBVP5_CROSS');
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(coalesce(p->'simulator_entries','[]'::jsonb)) LOOP
  IF e->>'symbol'<>p->>'symbol' OR e->>'timeframe'<>'5' OR EXISTS(SELECT 1 FROM public.sim_trades WHERE trade_id=e->>'trade_id') OR EXISTS(SELECT 1 FROM public.sim_breakeven_confirmations WHERE trade_id=e->>'trade_id') THEN CONTINUE;END IF;
  s:=CASE WHEN e->>'direction'='LONG' THEN 1 ELSE -1 END;
  pe:=(e->>'entry_price')::numeric;
  SELECT * INTO t FROM public.sim_trades WHERE status='OPEN' AND symbol=e->>'symbol' FOR UPDATE;
  IF FOUND AND p->>'mode'='live' AND a.enabled AND ct-t.entry_candle_time>=210*60000
   AND (t.quantity*(pe-t.entry_price)*(CASE WHEN t.direction='LONG' THEN 1 ELSE -1 END)-2*t.quantity*t.slippage_price-t.entry_fee-t.quantity*pe*0.0005)<0 THEN
   PERFORM public.sim_finish_trade(t.id,pe,'REPLACED_BY_SIGNAL',ts,true);
  END IF;
  SELECT * INTO a FROM public.sim_account WHERE id=1;
  m:=round(a.balance*0.05,8);
  why:=CASE WHEN p->>'mode'<>'live' THEN 'NOT_LIVE'
   WHEN e->>'symbol' NOT IN ('BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','LINKUSDT','NEARUSDT','BCHUSDT','LTCUSDT','ADAUSDT','AVAXUSDT') THEN 'COIN_NOT_APPROVED'
   WHEN NOT a.enabled THEN 'SIMULATOR_OFF' WHEN m<=0 THEN 'NO_BALANCE'
   WHEN a.balance-coalesce((SELECT sum(margin) FROM public.sim_trades WHERE status='OPEN'),0)<m THEN 'NO_BALANCE'
   WHEN EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN' AND symbol=e->>'symbol') THEN 'COIN_ALREADY_OPEN'
   WHEN (SELECT count(*) FROM public.sim_trades WHERE status='OPEN')>=6 THEN 'ALL_SLOTS_IN_USE' ELSE NULL END;
  IF why IS NULL THEN
   slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);q:=m*75/pe;fee:=m*75*0.0005;
   tp:=CASE WHEN s=1 THEN (pe*(1.0005+0.25/75.0)+2*slip)/0.9995 ELSE (pe*(0.9995-0.25/75.0)-2*slip)/1.0005 END;
   liq:=greatest(pe-s*(a.balance-coalesce((SELECT sum(margin) FROM public.sim_trades WHERE status='OPEN'),0)-fee-0.005*m*75)/q,0);
   INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct,breakeven)
    VALUES(e->>'trade_id',e->>'symbol',e->>'direction','NORMAL',75,m,m*75,q,pe,liq,tp,liq,ct,fee,a.balance,ts,'OBVP5_CROSS',slip,25,false) ON CONFLICT(trade_id) DO NOTHING;
  END IF;
  INSERT INTO public.sim_breakeven_confirmations(trade_id,symbol,direction,reference_price,breakeven_stop,breakeven_candle_time,status,reason,decided_at,mtf_trend,entry_price,take_profit,rule_version,signal_score)
  VALUES(e->>'trade_id',e->>'symbol',e->>'direction',pe,(e->>'stop_loss')::numeric,ct,CASE WHEN why IS NULL THEN 'CONFIRMED' ELSE 'SKIPPED' END,why,now(),NULL,pe,(e->>'take_profit')::numeric,'OBVP5_CROSS',(e->>'score')::integer) ON CONFLICT(trade_id) DO NOTHING;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;