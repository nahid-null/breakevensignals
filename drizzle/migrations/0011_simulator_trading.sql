CREATE TABLE public.sim_account (id integer PRIMARY KEY CHECK (id=1), balance numeric NOT NULL DEFAULT 0 CHECK (balance >= 0), total_deposited numeric NOT NULL DEFAULT 0 CHECK (total_deposited >= 0), enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.sim_account(id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.sim_account TO anon, authenticated;
GRANT ALL ON public.sim_account TO service_role;
ALTER TABLE public.sim_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read simulator account" ON public.sim_account FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.sim_deposits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount numeric NOT NULL CHECK (amount > 0), balance_after numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.sim_deposits TO anon, authenticated;
GRANT ALL ON public.sim_deposits TO service_role;
ALTER TABLE public.sim_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read simulator deposits" ON public.sim_deposits FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.sim_trades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trade_id text NOT NULL UNIQUE, symbol text NOT NULL, direction text NOT NULL CHECK (direction IN ('LONG','SHORT')),
 strength text NOT NULL CHECK (strength IN ('STRONG','NORMAL')), leverage integer NOT NULL CHECK (leverage BETWEEN 1 AND 50),
 margin numeric NOT NULL, notional numeric NOT NULL, quantity numeric NOT NULL, entry_price numeric NOT NULL, stop_loss numeric NOT NULL,
 take_profit numeric NOT NULL, liquidation_price numeric NOT NULL, breakeven boolean NOT NULL DEFAULT false, entry_candle_time bigint NOT NULL,
 entry_fee numeric NOT NULL, exit_fee numeric NOT NULL DEFAULT 0, exit_price numeric, gross_pnl numeric, pnl numeric,
 status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')), exit_reason text CHECK (exit_reason IN ('TAKE_PROFIT','STOP_LOSS','BREAKEVEN','LIQUIDATED')),
 balance_before numeric NOT NULL, balance_after numeric, opened_at timestamptz NOT NULL, closed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX sim_trades_one_open ON public.sim_trades ((true)) WHERE status='OPEN';
CREATE INDEX sim_trades_opened ON public.sim_trades (opened_at DESC);
GRANT SELECT ON public.sim_trades TO anon, authenticated;
GRANT ALL ON public.sim_trades TO service_role;
ALTER TABLE public.sim_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read simulator trades" ON public.sim_trades FOR SELECT TO anon, authenticated USING (true);

-- Rules: 80% of balance as isolated margin, STRONG 50x / NORMAL 20x, 0.05% taker fee per side,
-- liquidation at 0.5% maintenance margin, one simulated trade at a time, live trend-approved signals only.
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

CREATE OR REPLACE FUNCTION public.sim_deposit(amount numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE nb numeric;
BEGIN
 IF amount IS NULL OR amount<=0 OR amount>1000000000 THEN RAISE EXCEPTION 'Invalid amount'; END IF;
 UPDATE public.sim_account SET balance=balance+amount, total_deposited=total_deposited+amount, updated_at=now() WHERE id=1 RETURNING balance INTO nb;
 INSERT INTO public.sim_deposits(amount,balance_after) VALUES(amount,nb);
 RETURN jsonb_build_object('balance',nb);
END $$;
REVOKE ALL ON FUNCTION public.sim_deposit(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sim_deposit(numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.sim_set_enabled(on_off boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
 UPDATE public.sim_account SET enabled=on_off, updated_at=now() WHERE id=1;
$$;
REVOKE ALL ON FUNCTION public.sim_set_enabled(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sim_set_enabled(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint; saved_candle_time bigint; new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint; e jsonb; result jsonb; m jsonb:=p->'market'; provenance text:=CASE p->>'mode' WHEN 'live' THEN 'native' WHEN 'warmup' THEN 'historical' ELSE 'recovery' END; scan_increment integer:=CASE WHEN p->>'mode' IN ('live','recovery') THEN 1 ELSE 0 END;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,saved_candle_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;
 current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision); END IF;
 IF saved_candle_time IS NOT NULL AND new_time<=saved_candle_time THEN RAISE EXCEPTION 'Out of order candle'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  -- Only live trades approved by the 15M/5M/1M trend filter may queue Telegram notifications.
  result:=public.process_signal_event((e-'telegram_message')||jsonb_build_object('source',provenance),CASE WHEN provenance='native' AND coalesce(e->>'trend_aligned','false')='true' THEN coalesce(e->>'telegram_message','') ELSE '' END);
  IF coalesce(result->>'status','processed')<>'processed' THEN RAISE EXCEPTION 'Engine state mismatch: %',result->>'note'; END IF;
 END LOOP;
 -- Simulator trades the same live, trend-approved signals that go to Telegram.
 PERFORM public.simulate_engine_candle(p);
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error,successful_scans,mtf_trend) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error',scan_increment,NULLIF(m->'mtf_trend','null'::jsonb))
 ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,successful_scans=market_state.successful_scans+scan_increment,mtf_trend=EXCLUDED.mtf_trend,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;