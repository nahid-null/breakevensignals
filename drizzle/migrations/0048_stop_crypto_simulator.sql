ALTER TABLE public.cstf_account ADD COLUMN IF NOT EXISTS stopped_at timestamptz;
COMMENT ON COLUMN public.cstf_account.stopped_at IS 'When set, the crypto Simulator is permanently stopped: commits and status reports are ignored, history is kept.';
CREATE OR REPLACE FUNCTION public.cstf_commit(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.cstf_account; e jsonb; cfg public.app_settings; n integer; ts timestamptz; ids text[];
BEGIN
 -- prompt-79: the crypto Simulator was stopped by the user; refuse every new commit (no trades, no Telegram) and keep history.
 IF EXISTS (SELECT 1 FROM public.cstf_account WHERE id=1 AND stopped_at IS NOT NULL) THEN
  RETURN jsonb_build_object('conflict',false,'stopped',true,'revision',(SELECT revision FROM public.cstf_account WHERE id=1));
 END IF;
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 SELECT * INTO a FROM public.cstf_account WHERE id=1 FOR UPDATE;
 IF a.revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',a.revision); END IF;
 IF (a.last_minute IS NULL AND a.state IS NOT NULL) OR (a.last_minute IS NOT NULL AND (p->>'first_minute')::bigint<>a.last_minute+60000) THEN RAISE EXCEPTION 'Simulator minutes out of order'; END IF;
 IF (p->'state'->>'lastMinute')::bigint < (p->>'first_minute')::bigint THEN RAISE EXCEPTION 'Simulator batch has no minutes'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'opened') LOOP
  INSERT INTO public.cstf_trades(signal_id,symbol,side,pattern,signal_time,entry_time,entry_price,quantity,margin,entry_fee,target,liquidation_price)
  VALUES(e->>'signal_id',e->>'symbol',e->>'side',e->>'pattern',to_timestamp((e->>'signal_time')::bigint/1000.0),to_timestamp((e->>'entry_time')::bigint/1000.0),
   (e->>'entry_price')::numeric,(e->>'quantity')::numeric,(e->>'margin')::numeric,(e->>'entry_fee')::numeric,(e->>'target')::numeric,(e->>'liquidation_price')::numeric);
  INSERT INTO public.cstf_signals(signal_id,symbol,side,pattern,signal_time,decision,reason,mode)
  VALUES(e->>'signal_id',e->>'symbol',e->>'side',e->>'pattern',to_timestamp((e->>'signal_time')::bigint/1000.0),'OPENED',NULL,'live');
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'skipped') LOOP
  INSERT INTO public.cstf_signals(signal_id,symbol,side,pattern,signal_time,decision,reason,mode)
  VALUES(e->>'signal_id',e->>'symbol',e->>'side',e->>'pattern',to_timestamp((e->>'signal_time')::bigint/1000.0),'SKIPPED',e->>'reason',e->>'mode');
 END LOOP;
 SELECT * INTO cfg FROM public.app_settings WHERE id=1;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'closed') LOOP
  ts:=to_timestamp((e->>'exit_time')::bigint/1000.0);
  UPDATE public.cstf_trades SET status='CLOSED',exit_reason=e->>'reason',exit_time=ts,exit_price=(e->>'exit_price')::numeric,gross=(e->>'gross')::numeric,
   exit_fee=(e->>'exit_fee')::numeric,funding=(e->>'funding')::numeric,net=(e->>'net')::numeric,wallet_after=(e->>'wallet_after')::numeric,closed_mode=e->>'mode',
   mark_price=NULL,unrealized=NULL,updated_at=now() WHERE signal_id=e->>'signal_id' AND status='OPEN';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Closed Simulator trade % is not open', e->>'signal_id'; END IF;
  IF coalesce(cfg.telegram_enabled,false) THEN
   INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message)
   SELECT e->>'signal_id'||'-cstf-result',e->>'signal_id',t.symbol,t.side,e->>'message' FROM public.cstf_trades t WHERE t.signal_id=e->>'signal_id'
   ON CONFLICT(event_id) DO NOTHING;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'open') LOOP
  UPDATE public.cstf_trades SET target=(e->>'target')::numeric,liquidation_price=(e->>'liquidation_price')::numeric,funding=(e->>'funding')::numeric,
   mark_price=(e->>'mark_price')::numeric,unrealized=(e->>'unrealized')::numeric,updated_at=now() WHERE signal_id=e->>'signal_id' AND status='OPEN';
 END LOOP;
 SELECT array_agg(x->'signal'->>'id' ORDER BY x->'signal'->>'id') INTO ids FROM jsonb_array_elements(p->'state'->'positions') x;
 IF coalesce(ids,'{}')<>coalesce((SELECT array_agg(signal_id ORDER BY signal_id) FROM public.cstf_trades WHERE status='OPEN'),'{}') THEN
  RAISE EXCEPTION 'Simulator open positions out of sync';
 END IF;
 UPDATE public.cstf_account SET revision=a.revision+1,state=p->'state',last_minute=(p->'state'->>'lastMinute')::bigint,wallet=(p->'state'->>'wallet')::numeric,
  equity=(p->>'equity')::numeric,maintenance=(p->>'maintenance')::numeric,open_count=jsonb_array_length(p->'state'->'positions'),
  status=CASE WHEN p->>'mode'='live' THEN 'RUNNING' ELSE 'CATCHING_UP' END,error=NULL,started_at=coalesce(a.started_at,to_timestamp((p->>'first_minute')::bigint/1000.0)),
  checked_at=now(),updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('conflict',false,'revision',a.revision+1);
END $$;
CREATE OR REPLACE FUNCTION public.cstf_report_status(p jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now();
 IF NOT FOUND THEN RETURN false; END IF;
 IF EXISTS (SELECT 1 FROM public.cstf_account WHERE id=1 AND stopped_at IS NOT NULL) THEN RETURN true; END IF;
 UPDATE public.cstf_account SET status=left(p->>'status',30),error=left(p->>'error',400),checked_at=now() WHERE id=1;
 RETURN true;
END $$;