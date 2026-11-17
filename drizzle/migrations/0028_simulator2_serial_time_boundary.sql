ALTER TABLE public.sim2_account ADD COLUMN available_after_time bigint NOT NULL DEFAULT 0;
DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.simulate2_engine_candle(jsonb)'::regprocedure) INTO definition;
 definition:=replace(definition, 'THEN RAISE EXCEPTION ''Invalid Simulator 2 candle''; END IF;', 'THEN RETURN; END IF;');
 definition:=replace(definition, 'IF NOT FOUND THEN RETURN; END IF;', 'IF NOT FOUND THEN RETURN; END IF; IF p->>''mode''=''live'' AND ct+60000 < extract(epoch FROM a.session_started_at)*1000 THEN RETURN; END IF;');
 definition:=replace(definition, 'SET balance=nb WHERE id=1;', 'SET balance=nb,available_after_time=ct+60000 WHERE id=1;');
 definition:=replace(definition, 'IF NOT a.enabled OR a.balance<=0 OR a.pending_symbol IS NOT NULL THEN RETURN; END IF;', 'IF NOT a.enabled OR a.balance<=0 OR a.pending_symbol IS NOT NULL OR ct+60000<a.available_after_time THEN RETURN; END IF;');
 EXECUTE definition;
END $$;