UPDATE public.sim_breakeven_confirmations SET status='SKIPPED',reason='RULE_REPLACED',decided_at=now() WHERE status='WAITING';
ALTER TABLE public.sim_breakeven_confirmations ADD COLUMN mtf_trend jsonb, ADD COLUMN entry_price numeric;
CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;s integer;px numeric;why text;m numeric;q numeric;entry numeric;fee numeric;slip numeric;tp numeric;liq numeric;ct bigint:=(c->>'time')::bigint;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;t15 integer;t5 integer;t1 integer;pe numeric;ptp numeric;
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
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN' AND rule_version NOT IN ('PINE_BE_CONFIRM','PINE_BE_TREND');
   IF p->>'mode'='live' AND EXISTS(SELECT 1 FROM public.active_positions WHERE trade_id=e->>'trade_id' AND source='native') AND NOT EXISTS(SELECT 1 FROM public.sim_trades WHERE trade_id=e->>'trade_id') AND NOT EXISTS(SELECT 1 FROM public.sim_breakeven_confirmations WHERE trade_id=e->>'trade_id') THEN
    s:=CASE WHEN e->>'direction'='LONG' THEN 1 ELSE -1 END;
    t15:=(e->'mtf_trend'->>'m15')::integer;t5:=(e->'mtf_trend'->>'m5')::integer;t1:=(e->'mtf_trend'->>'m1')::integer;
    -- Breakeven trigger = Pine entry + 1R (breakevenTrigger=1); R = |take_profit-entry|/1.5 (rrMultiplier).
    pe:=(e->>'entry_price')::numeric;ptp:=(e->>'take_profit')::numeric;entry:=pe+s*abs(ptp-pe)/1.5;
    SELECT * INTO a FROM public.sim_account WHERE id=1;
    why:=CASE WHEN t15 IS NULL OR t5 IS NULL OR t1 IS NULL THEN 'TREND_UNKNOWN'
     WHEN t15=0 OR t15<>t5 THEN 'NO_15M_5M_BIAS'
     WHEN t15<>s THEN 'BIAS_OPPOSITE_SIGNAL'
     WHEN t1=-s THEN 'ONE_MINUTE_OPPOSITE'
     WHEN NOT a.enabled THEN 'SIMULATOR_OFF' WHEN a.balance<=0 THEN 'NO_BALANCE'
     WHEN EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN 'TRADE_ALREADY_OPEN' ELSE NULL END;
    IF why IS NULL THEN
     m:=round(a.balance*0.8,8);q:=m*50/entry;fee:=m*50*0.0005;slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);
     tp:=(entry*s+(m*0.10+fee)/q+2*slip)/(s-0.0005);
     liq:=entry*(1-s*(1.0/50-0.005));
     INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct,breakeven)
     VALUES(e->>'trade_id',e->>'symbol',e->>'direction','NORMAL',50,m,m*50,q,entry,(e->>'stop_loss')::numeric,tp,liq,ct,fee,a.balance,ts,'PINE_BE_TREND',slip,10,false) ON CONFLICT(trade_id) DO NOTHING;
    END IF;
    INSERT INTO public.sim_breakeven_confirmations(trade_id,symbol,direction,reference_price,breakeven_stop,breakeven_candle_time,status,reason,decided_at,mtf_trend,entry_price)
    VALUES(e->>'trade_id',e->>'symbol',e->>'direction',pe,(e->>'stop_loss')::numeric,ct,CASE WHEN why IS NULL THEN 'CONFIRMED' ELSE 'SKIPPED' END,why,now(),e->'mtf_trend',entry) ON CONFLICT(trade_id) DO NOTHING;
   END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;
DO $$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('public.commit_engine_candle(jsonb)'::regprocedure) INTO d;
 d:=replace(d,' PERFORM public.simulate2_engine_candle(p);','');
 EXECUTE d;
END $$;
DROP FUNCTION IF EXISTS public.simulate2_engine_candle(jsonb);
DROP FUNCTION IF EXISTS public.sim2_reset();
DROP FUNCTION IF EXISTS public.sim2_set_enabled(boolean);
DELETE FROM public.sim2_balance_events;
DELETE FROM public.sim2_trades;
DELETE FROM public.sim2_account;
COMMENT ON TABLE public.sim2_account IS 'DEPRECATED: Simulator 2 removed at user request; data erased. Drop after next publish.';
COMMENT ON TABLE public.sim2_trades IS 'DEPRECATED: Simulator 2 removed at user request; data erased. Drop after next publish.';
COMMENT ON TABLE public.sim2_balance_events IS 'DEPRECATED: Simulator 2 removed at user request; data erased. Drop after next publish.';