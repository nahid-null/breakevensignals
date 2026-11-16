CREATE OR REPLACE FUNCTION public.simulate_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1; t public.sim_trades; acct public.sim_account; e jsonb; v_lev integer; v_margin numeric; v_notional numeric; v_qty numeric; v_entry numeric; v_liq numeric; v_exitp numeric; v_gross numeric; v_fee numeric; v_pnl numeric; v_sign integer; v_stop_hit boolean; v_nb numeric;
 fee_rate constant numeric:=0.0005; mmr constant numeric:=0.005; c_time bigint:=(c->>'time')::bigint; c_high numeric:=(c->>'high')::numeric; c_low numeric:=(c->>'low')::numeric;
BEGIN
 IF p->>'mode'<>'live' OR c IS NULL THEN RETURN; END IF;
 SELECT * INTO acct FROM public.sim_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 -- 1. Liquidation of an open simulated trade on this symbol (checked on candles after entry).
 SELECT * INTO t FROM public.sim_trades WHERE status='OPEN' AND symbol=p->>'symbol' FOR UPDATE;
 IF FOUND AND c_time>t.entry_candle_time AND ((t.direction='LONG' AND c_low<=t.liquidation_price) OR (t.direction='SHORT' AND c_high>=t.liquidation_price)) THEN
  v_stop_hit:=EXISTS(SELECT 1 FROM jsonb_array_elements(p->'events') x WHERE x.value->>'trade_id'=t.trade_id AND x.value->>'event'='stop_loss_hit');
  -- The stop is reached first when it sits between entry and the liquidation price.
  IF NOT v_stop_hit OR (t.direction='LONG' AND t.stop_loss<t.liquidation_price) OR (t.direction='SHORT' AND t.stop_loss>t.liquidation_price) THEN
   v_nb:=greatest(acct.balance-t.margin-t.entry_fee,0);
   UPDATE public.sim_trades SET status='CLOSED', exit_reason='LIQUIDATED', exit_price=t.liquidation_price, gross_pnl=-t.margin, pnl=v_nb-acct.balance, balance_after=v_nb, closed_at=to_timestamp((c_time+60000)/1000.0) WHERE id=t.id;
   UPDATE public.sim_account SET balance=v_nb, updated_at=now() WHERE id=1; acct.balance:=v_nb;
  END IF;
 END IF;
 -- 2. Trade events, in engine order (exits before new entries).
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  CONTINUE WHEN coalesce(e->>'trend_aligned','false')<>'true';
  IF e->>'event'='entry_confirmed' THEN
   -- Only entries actually queued for Telegram (same switches as Settings) are simulated.
   CONTINUE WHEN NOT EXISTS(SELECT 1 FROM public.telegram_logs WHERE event_id=e->>'event_id' AND NOT is_test);
   CONTINUE WHEN NOT acct.enabled OR acct.balance<=0 OR EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN');
   v_lev:=CASE WHEN e->>'signal_strength'='STRONG' THEN 50 ELSE 20 END;
   v_entry:=(e->>'entry_price')::numeric; v_margin:=round(acct.balance*0.8,8); v_notional:=v_margin*v_lev; v_qty:=v_notional/v_entry; v_fee:=v_notional*fee_rate;
   v_liq:=CASE WHEN e->>'direction'='LONG' THEN v_entry*(1-1.0/v_lev+mmr) ELSE v_entry*(1+1.0/v_lev-mmr) END;
   INSERT INTO public.sim_trades(trade_id,symbol,direction,strength,leverage,margin,notional,quantity,entry_price,stop_loss,take_profit,liquidation_price,entry_candle_time,entry_fee,balance_before,opened_at)
   VALUES(e->>'trade_id',e->>'symbol',e->>'direction',CASE WHEN e->>'signal_strength'='STRONG' THEN 'STRONG' ELSE 'NORMAL' END,v_lev,v_margin,v_notional,v_qty,v_entry,(e->>'stop_loss')::numeric,(e->>'take_profit')::numeric,v_liq,c_time,v_fee,acct.balance,(e->>'timestamp')::timestamptz)
   ON CONFLICT (trade_id) DO NOTHING;
  ELSIF e->>'event'='breakeven_activated' THEN
   UPDATE public.sim_trades SET breakeven=true, stop_loss=(e->>'stop_loss')::numeric WHERE trade_id=e->>'trade_id' AND status='OPEN';
  ELSIF e->>'event' IN ('stop_loss_hit','take_profit_hit') THEN
   SELECT * INTO t FROM public.sim_trades WHERE trade_id=e->>'trade_id' AND status='OPEN' FOR UPDATE;
   CONTINUE WHEN NOT FOUND;
   v_exitp:=(e->>'exit_price')::numeric; v_sign:=CASE WHEN t.direction='LONG' THEN 1 ELSE -1 END;
   v_gross:=greatest(t.quantity*(v_exitp-t.entry_price)*v_sign,-t.margin); v_fee:=t.quantity*v_exitp*fee_rate;
   v_nb:=greatest(acct.balance+v_gross-t.entry_fee-v_fee,0); v_pnl:=v_nb-acct.balance;
   UPDATE public.sim_trades SET status='CLOSED', exit_price=v_exitp, exit_fee=v_fee, gross_pnl=v_gross, pnl=v_pnl, balance_after=v_nb, closed_at=(e->>'timestamp')::timestamptz,
    exit_reason=CASE WHEN e->>'event'='take_profit_hit' THEN 'TAKE_PROFIT' WHEN t.breakeven THEN 'BREAKEVEN' ELSE 'STOP_LOSS' END WHERE id=t.id;
   UPDATE public.sim_account SET balance=v_nb, updated_at=now() WHERE id=1; acct.balance:=v_nb;
  END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.simulate_engine_candle(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_engine_candle(jsonb) TO service_role;