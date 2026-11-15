CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint; saved_candle_time bigint; new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint; e jsonb; result jsonb; m jsonb:=p->'market'; provenance text:=CASE p->>'mode' WHEN 'live' THEN 'native' WHEN 'warmup' THEN 'historical' ELSE 'recovery' END;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,saved_candle_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;
 current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision); END IF;
 IF saved_candle_time IS NOT NULL AND new_time<=saved_candle_time THEN RAISE EXCEPTION 'Out of order candle'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'events') LOOP
  result:=public.process_signal_event((e-'telegram_message')||jsonb_build_object('source',provenance),CASE WHEN provenance='native' THEN coalesce(e->>'telegram_message','') ELSE '' END);
  IF coalesce(result->>'status','processed')<>'processed' THEN RAISE EXCEPTION 'Engine state mismatch: %',result->>'note'; END IF;
 END LOOP;
 INSERT INTO public.engine_checkpoints(symbol,revision,last_candle_time,state) VALUES(p->>'symbol',current_revision+1,new_time,p->'checkpoint') ON CONFLICT(symbol) DO UPDATE SET revision=EXCLUDED.revision,last_candle_time=EXCLUDED.last_candle_time,state=EXCLUDED.state,updated_at=now();
 INSERT INTO public.market_state(symbol,price,trend,status,last_candle_at,long_score,short_score,error) VALUES(m->>'symbol',NULLIF(m->>'price','')::numeric,m->>'trend',m->>'status',NULLIF(m->>'last_candle_at','')::timestamptz,(m->>'long_score')::integer,(m->>'short_score')::integer,m->>'error')
 ON CONFLICT(symbol) DO UPDATE SET price=EXCLUDED.price,trend=EXCLUDED.trend,status=EXCLUDED.status,last_candle_at=EXCLUDED.last_candle_at,long_score=EXCLUDED.long_score,short_score=EXCLUDED.short_score,error=EXCLUDED.error,updated_at=now();
 RETURN jsonb_build_object('conflict',false,'revision',current_revision+1);
END $$;
REVOKE ALL ON FUNCTION public.commit_engine_candle(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commit_engine_candle(jsonb) TO service_role;