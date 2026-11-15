CREATE OR REPLACE FUNCTION public.commit_engine_candle(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_revision bigint; current_time bigint; new_time bigint:=(p->'checkpoint'->>'lastTime')::bigint; e jsonb; result jsonb; m jsonb:=p->'market'; provenance text:=CASE p->>'mode' WHEN 'live' THEN 'native' WHEN 'warmup' THEN 'historical' ELSE 'recovery' END;
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('engine:'||(p->>'symbol')));
 SELECT revision,last_candle_time INTO current_revision,current_time FROM public.engine_checkpoints WHERE symbol=p->>'symbol' FOR UPDATE;
 current_revision:=coalesce(current_revision,0);
 IF current_revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',current_revision); END IF;
 IF current_time IS NOT NULL AND new_time<=current_time THEN RAISE EXCEPTION 'Out of order candle'; END IF;
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
CREATE OR REPLACE FUNCTION public.terminal_statistics() RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object(
 'activeLong', (SELECT count(*) FROM public.active_positions WHERE direction='LONG' AND status IN('ACTIVE','BREAKEVEN')),
 'activeShort', (SELECT count(*) FROM public.active_positions WHERE direction='SHORT' AND status IN('ACTIVE','BREAKEVEN')),
 'breakeven',(SELECT count(*) FROM public.active_positions WHERE status='BREAKEVEN'),
 'completed',(SELECT count(*) FROM public.active_positions WHERE status IN('STOP_LOSS_HIT','TAKE_PROFIT_HIT')),
 'wins',(SELECT count(*) FROM public.active_positions WHERE net_result_r>0),
 'losses',(SELECT count(*) FROM public.active_positions WHERE net_result_r<=0),
 'netR',(SELECT coalesce(sum(net_result_r),0) FROM public.active_positions),
 'entries',(SELECT count(*) FROM public.signal_events WHERE event_type='entry_confirmed'),
 'breakevenEvents',(SELECT count(*) FROM public.signal_events WHERE event_type='breakeven_activated'),
 'telegramSent',(SELECT count(*) FROM public.telegram_logs WHERE delivery_status='SENT' AND NOT is_test));
$$;
REVOKE ALL ON FUNCTION public.terminal_statistics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_statistics() TO anon,authenticated,service_role;