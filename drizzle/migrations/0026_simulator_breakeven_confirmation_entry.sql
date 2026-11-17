CREATE TABLE public.sim_breakeven_confirmations (trade_id text PRIMARY KEY, symbol text NOT NULL, direction text NOT NULL CHECK(direction IN ('LONG','SHORT')), reference_price numeric NOT NULL, breakeven_stop numeric NOT NULL, breakeven_candle_time bigint NOT NULL, status text NOT NULL DEFAULT 'WAITING' CHECK(status IN ('WAITING','CONFIRMED','SKIPPED')), reason text, confirm_open numeric, confirm_close numeric, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.sim_breakeven_confirmations TO service_role;
ALTER TABLE public.sim_breakeven_confirmations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sim_breakeven_confirmations FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1;t public.sim_trades;a public.sim_account;e jsonb;w public.sim_breakeven_confirmations;s integer;px numeric;why text;m numeric;q numeric;entry numeric;fee numeric;slip numeric;tp numeric;liq numeric;ct bigint:=(c->>'time')::bigint;op numeric:=(c->>'open')::numeric;cl numeric:=(c->>'close')::numeric;hi numeric:=(c->>'high')::numeric;lo numeric:=(c->>'low')::numeric;ts timestamptz:=to_timestamp((ct+60000)/1000.0);stop_hit boolean;liq_hit boolean;tp_hit boolean;ok boolean;
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
  IF t.rule_version IN ('PINE_NET10','PINE_BE_CONFIRM') THEN
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
 FOR w IN SELECT * FROM public.sim_breakeven_confirmations WHERE symbol=p->>'symbol' AND status='WAITING' AND breakeven_candle_time<ct FOR UPDATE LOOP
  s:=CASE WHEN w.direction='LONG' THEN 1 ELSE -1 END;
  ok:=CASE WHEN s=1 THEN cl>op AND op>w.reference_price AND cl>w.reference_price AND w.breakeven_stop<cl ELSE cl<op AND op<w.reference_price AND cl<w.reference_price AND w.breakeven_stop>cl END;
  SELECT * INTO a FROM public.sim_account WHERE id=1;
  why:=CASE WHEN p->>'mode'<>'live' THEN 'NOT_LIVE'
   WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(p->'events') x WHERE x->>'trade_id'=w.trade_id AND x->>'event' IN ('stop_loss_hit','take_profit_hit')) THEN 'PINE_TRADE_CLOSED'
   WHEN NOT ok THEN 'CANDLE_NOT_CONFIRMED'
   WHEN NOT a.enabled THEN 'SIMULATOR_OFF' WHEN a.balance<=0 THEN 'NO_BALANCE'
   WHEN EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN 'TRADE_ALREADY_OPEN' ELSE NULL END;
  IF why IS NULL THEN
   entry:=cl;m:=round(a.balance*0.8,8);q:=m*50/entry;fee:=m*50*0.0005;slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);
   tp:=(entry*s+(m*0.10+fee)/q+2*slip)/(s-0.0005);
   liq:=entry*(1-s*(1.0/50-0.005));
   INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at,rule_version,slippage_price,target_net_roi_pct,breakeven)
   VALUES(w.trade_id,w.symbol,w.direction,'NORMAL',50,m,m*50,q,entry,w.breakeven_stop,tp,liq,ct,fee,a.balance,ts,'PINE_BE_CONFIRM',slip,10,true) ON CONFLICT(trade_id) DO NOTHING;
  END IF;
  UPDATE public.sim_breakeven_confirmations SET status=CASE WHEN why IS NULL THEN 'CONFIRMED' ELSE 'SKIPPED' END,reason=why,confirm_open=op,confirm_close=cl,decided_at=now() WHERE trade_id=w.trade_id;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  IF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true,stop_loss=CASE WHEN direction='LONG' THEN greatest(stop_loss,(e->>'stop_loss')::numeric) ELSE least(stop_loss,(e->>'stop_loss')::numeric) END WHERE trade_id=e->>'trade_id' AND status='OPEN';
   IF p->>'mode'='live' AND EXISTS(SELECT 1 FROM public.active_positions WHERE trade_id=e->>'trade_id' AND source='native') AND NOT EXISTS(SELECT 1 FROM public.sim_trades WHERE trade_id=e->>'trade_id') THEN
    INSERT INTO public.sim_breakeven_confirmations(trade_id,symbol,direction,reference_price,breakeven_stop,breakeven_candle_time)
    VALUES(e->>'trade_id',e->>'symbol',e->>'direction',(e->>'entry_price')::numeric,(e->>'stop_loss')::numeric,ct) ON CONFLICT(trade_id) DO NOTHING;
   END IF;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;