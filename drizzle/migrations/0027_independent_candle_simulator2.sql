CREATE TABLE public.sim2_account (
 id integer PRIMARY KEY CHECK(id=1), balance numeric NOT NULL DEFAULT 5 CHECK(balance>=0),
 session_id uuid NOT NULL DEFAULT gen_random_uuid(), session_started_at timestamptz NOT NULL DEFAULT now(),
 enabled boolean NOT NULL DEFAULT true, pending_symbol text, pending_direction text CHECK(pending_direction IN('LONG','SHORT')),
 pending_time bigint, pending_session uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sim2_account TO service_role;
ALTER TABLE public.sim2_account ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.sim2_trades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL, symbol text NOT NULL,
 direction text NOT NULL CHECK(direction IN('LONG','SHORT')), leverage integer NOT NULL DEFAULT 50 CHECK(leverage=50),
 margin numeric NOT NULL, quantity numeric NOT NULL, entry_price numeric NOT NULL, stop_loss numeric NOT NULL,
 take_profit numeric NOT NULL, liquidation_price numeric NOT NULL, exit_price numeric NOT NULL,
 entry_fee numeric NOT NULL, exit_fee numeric NOT NULL, slippage_cost numeric NOT NULL,
 pnl numeric NOT NULL, balance_before numeric NOT NULL, balance_after numeric NOT NULL,
 signal_time bigint NOT NULL, opened_at timestamptz NOT NULL, closed_at timestamptz NOT NULL,
 exit_reason text NOT NULL CHECK(exit_reason IN('TAKE_PROFIT','STOP_LOSS','ONE_CANDLE','LIQUIDATED')),
 source text NOT NULL DEFAULT 'native', UNIQUE(session_id,symbol,signal_time)
);
GRANT ALL ON public.sim2_trades TO service_role;
ALTER TABLE public.sim2_trades ENABLE ROW LEVEL SECURITY;
CREATE INDEX sim2_trades_session ON public.sim2_trades(session_id,closed_at DESC);
CREATE TABLE public.sim2_balance_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), previous_session uuid NOT NULL, next_session uuid NOT NULL,
 balance_before numeric NOT NULL, balance_after numeric NOT NULL DEFAULT 5, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sim2_balance_events TO service_role;
ALTER TABLE public.sim2_balance_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sim2_account,public.sim2_trades,public.sim2_balance_events FROM anon,authenticated;
INSERT INTO public.sim2_account(id) SELECT id FROM public.sim_account WHERE id=1;
CREATE OR REPLACE FUNCTION public.sim2_reset() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.sim2_account; next_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO a FROM public.sim2_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Simulator 2 account missing'; END IF;
 INSERT INTO public.sim2_balance_events(previous_session,next_session,balance_before) VALUES(a.session_id,next_id,a.balance);
 UPDATE public.sim2_account SET balance=5,session_id=next_id,session_started_at=now(),enabled=true,
 pending_symbol=NULL,pending_direction=NULL,pending_time=NULL,pending_session=NULL,updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('balance',5,'session_id',next_id);
END $$;
REVOKE ALL ON FUNCTION public.sim2_reset() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim2_reset() TO service_role;
CREATE OR REPLACE FUNCTION public.sim2_set_enabled(on_off boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF on_off IS NULL THEN RAISE EXCEPTION 'Invalid enabled state'; END IF;
 UPDATE public.sim2_account SET enabled=on_off,pending_symbol=NULL,pending_direction=NULL,pending_time=NULL,pending_session=NULL,updated_at=now() WHERE id=1;
END $$;
REVOKE ALL ON FUNCTION public.sim2_set_enabled(boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim2_set_enabled(boolean) TO service_role;
CREATE OR REPLACE FUNCTION public.simulate2_engine_candle(p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb:=p->'checkpoint'->'candles'->-1; previous jsonb;
 a public.sim2_account; ct bigint:=(c->>'time')::bigint; op numeric:=(c->>'open')::numeric;
 hi numeric:=(c->>'high')::numeric; lo numeric:=(c->>'low')::numeric; cl numeric:=(c->>'close')::numeric;
 s integer; m numeric; q numeric; f numeric; slip numeric; tp numeric; sl numeric; liq numeric;
 px numeric; reason text; ef numeric; gross numeric; net numeric; nb numeric; candidate text;
BEGIN
 IF c IS NULL OR p->>'mode' NOT IN('live','recovery') THEN RETURN; END IF;
 IF op<=0 OR lo<=0 OR hi<greatest(op,cl) OR lo>least(op,cl) OR hi<lo THEN RAISE EXCEPTION 'Invalid Simulator 2 candle'; END IF;
 SELECT * INTO a FROM public.sim2_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF a.pending_symbol=p->>'symbol' THEN
  IF p->>'mode'='live' AND a.enabled AND a.pending_session=a.session_id AND ct=a.pending_time+60000 AND a.balance>0 THEN
   s:=CASE WHEN a.pending_direction='LONG' THEN 1 ELSE -1 END;
   m:=a.balance*0.8; q:=m*50/op; f:=m*50*0.0005;
   slip:=coalesce((p->'checkpoint'->>'tickSize')::numeric,0);
   tp:=(op*s+(a.balance*0.10+f)/q+2*slip)/(s-0.0005);
   sl:=(op*s+(-a.balance*0.05+f)/q+2*slip)/(s-0.0005);
   liq:=op*(1-s*(1.0/50-0.005));
   IF slip>0 AND s*(op-sl)>0 AND s*(sl-liq)>0 AND s*(tp-op)>0 THEN
    IF (s=1 AND lo<=sl) OR(s=-1 AND hi>=sl) THEN px:=sl;reason:='STOP_LOSS';
    ELSIF (s=1 AND lo<=liq) OR(s=-1 AND hi>=liq) THEN px:=liq;reason:='LIQUIDATED';
    ELSIF (s=1 AND hi>=tp) OR(s=-1 AND lo<=tp) THEN px:=tp;reason:='TAKE_PROFIT';
    ELSE px:=cl;reason:='ONE_CANDLE';END IF;
    ef:=CASE WHEN reason='LIQUIDATED' THEN 0 ELSE q*px*0.0005 END;
    gross:=CASE WHEN reason='LIQUIDATED' THEN -m ELSE greatest(q*(px-op)*s-2*q*slip,-m) END;
    nb:=greatest(a.balance+gross-f-ef,0);net:=nb-a.balance;
    INSERT INTO public.sim2_trades(session_id,symbol,direction,margin,quantity,entry_price,stop_loss,take_profit,liquidation_price,
     exit_price,entry_fee,exit_fee,slippage_cost,pnl,balance_before,balance_after,signal_time,opened_at,closed_at,exit_reason)
    VALUES(a.session_id,p->>'symbol',a.pending_direction,m,q,op,sl,tp,liq,px,f,ef,2*q*slip,net,a.balance,nb,
     a.pending_time,to_timestamp(ct/1000.0),to_timestamp((ct+60000)/1000.0),reason);
    UPDATE public.sim2_account SET balance=nb WHERE id=1;
   END IF;
  END IF;
  UPDATE public.sim2_account SET pending_symbol=NULL,pending_direction=NULL,pending_time=NULL,pending_session=NULL,updated_at=now() WHERE id=1;
 END IF;
 IF p->>'mode'<>'live' THEN RETURN; END IF;
 SELECT * INTO a FROM public.sim2_account WHERE id=1;
 IF NOT a.enabled OR a.balance<=0 OR a.pending_symbol IS NOT NULL THEN RETURN; END IF;
 SELECT state->'candles'->-1 INTO previous FROM public.engine_checkpoints WHERE symbol=p->>'symbol';
 IF previous IS NULL OR (previous->>'time')::bigint<>ct-60000 OR hi=lo THEN RETURN; END IF;
 IF abs(cl-op)/(hi-lo)<0.60 THEN RETURN; END IF;
 candidate:=CASE WHEN cl>op AND cl>(previous->>'high')::numeric THEN 'LONG'
                 WHEN cl<op AND cl<(previous->>'low')::numeric THEN 'SHORT' ELSE NULL END;
 IF candidate IS NOT NULL THEN
  UPDATE public.sim2_account SET pending_symbol=p->>'symbol',pending_direction=candidate,pending_time=ct,
   pending_session=session_id,updated_at=now() WHERE id=1;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.simulate2_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.simulate2_engine_candle(jsonb) TO service_role;
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
 PERFORM public.simulate2_engine_candle(p);
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error,successful_scans,mtf_trend) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error',scan_increment,NULLIF(m->'mtf_trend','null'::jsonb)) ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,successful_scans=market_state.successful_scans+scan_increment,mtf_trend=EXCLUDED.mtf_trend,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;
COMMENT ON TABLE public.sim2_trades IS 'Independent candle-only practice results. Reset hides archived sessions, never deletes financial evidence. OHLC stop-first execution is modeled, not exchange fills.';