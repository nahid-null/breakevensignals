CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;s integer;px numeric;why text;m numeric;q numeric;fee numeric;slip numeric;liq numeric;ct bigint:=(c->>'time')::bigint;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;t15 integer;t5 integer;t1 integer;pe numeric;tp numeric;
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
  ELSIF t.rule_version='PINE1_CROSS' THEN
   IF liq_hit THEN px:=t.liquidation_price;why:='LIQUIDATED';ELSIF tp_hit THEN px:=t.take_profit;why:='TAKE_PROFIT';
   ELSIF ct+60000-t.entry_candle_time>=86400000 THEN px:=(c->>'close')::numeric;why:='TIME_EXIT';END IF;
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
  IF px IS NOT NULL THEN PERFORM public.sim_finish_trade(t.id,px,why,ts,t.rule_version IN ('PINE5_TREND','PINE1_CROSS') OR p->>'mode'='live');END IF;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  IF coalesce((e->>'adopted')::boolean,false) THEN CONTINUE;END IF;
  IF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN' AND rule_version NOT IN ('PINE_BE_CONFIRM','PINE_BE_TREND','PINE1_CROSS');
  END IF;
  -- prompt-42: 1-minute Pine entries with the Trend Identify filter restored; up to two open trades, one per coin.
  IF e->>'event'='entry_confirmed' AND e->>'timeframe'='1' AND NOT EXISTS(SELECT 1 FROM public.sim_trades WHERE trade_id=e->>'trade_id') AND NOT EXISTS(SELECT 1 FROM public.sim_breakeven_confirmations WHERE trade_id=e->>'trade_id') THEN
   s:=CASE WHEN e->>'direction'='LONG' THEN 1 ELSE -1 END;
   t15:=(e->'mtf_trend'->>'m15')::integer;t5:=(e->'mtf_trend'->>'m5')::integer;t1:=(e->'mtf_trend'->>'m1')::integer;
   pe:=(e->>'entry_price')::numeric;
   SELECT * INTO a FROM public.sim_account WHERE id=1;
   m:=round(a.balance*0.2,8);
   why:=CASE WHEN p->>'mode'<>'live' THEN 'NOT_LIVE'
    WHEN t15 IS NULL OR t5 IS NULL OR t1 IS NULL THEN 'TREND_UNKNOWN'
    WHEN t15=0 OR t15<>t5 THEN 'NO_15M_5M_BIAS'
    WHEN t15<>s THEN 'BIAS_OPPOSITE_SIGNAL'
    WHEN t1=-s THEN 'ONE_MINUTE_OPPOSITE'
    WHEN NOT a.enabled THEN 'SIMULATOR_OFF' WHEN m<=0 THEN 'NO_BALANCE'
    -- Free balance (not held by the other open slot) must cover this trade's margin.
    WHEN a.balance-coalesce((SELECT sum(margin) FROM public.sim_trades WHERE status='OPEN'),0)<m THEN 'NO_BALANCE'
    WHEN EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN' AND symbol=e->>'symbol') THEN 'COIN_ALREADY_OPEN'
    WHEN (SELECT count(*) FROM public.sim_trades WHERE status='OPEN')>=2 THEN 'BOTH_SLOTS_IN_USE' ELSE NULL END;
   IF why IS NULL THEN
    slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);q:=m*50/pe;fee:=m*50*0.0005;
    tp:=CASE WHEN s=1 THEN (pe*1.0055+2*slip)/0.9995 ELSE (pe*0.9945-2*slip)/1.0005 END;
    liq:=greatest(pe-s*(a.balance-coalesce((SELECT sum(margin) FROM public.sim_trades WHERE status='OPEN'),0)-fee-0.005*m*50)/q,0);
    INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct,breakeven)
    VALUES(e->>'trade_id',e->>'symbol',e->>'direction','NORMAL',50,m,m*50,q,pe,liq,tp,liq,ct,fee,a.balance,ts,'PINE1_CROSS',slip,25,false) ON CONFLICT(trade_id) DO NOTHING;
   END IF;
   INSERT INTO public.sim_breakeven_confirmations(trade_id,symbol,direction,reference_price,breakeven_stop,breakeven_candle_time,status,reason,decided_at,mtf_trend,entry_price,take_profit,rule_version)
   VALUES(e->>'trade_id',e->>'symbol',e->>'direction',pe,(e->>'stop_loss')::numeric,ct,CASE WHEN why IS NULL THEN 'CONFIRMED' ELSE 'SKIPPED' END,why,now(),e->'mtf_trend',pe,(e->>'take_profit')::numeric,'PINE1_CROSS') ON CONFLICT(trade_id) DO NOTHING;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;