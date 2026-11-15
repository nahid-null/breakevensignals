ALTER TABLE public.engine_health ADD COLUMN runtime_mode text NOT NULL DEFAULT 'production' CHECK(runtime_mode IN('production','temporary'));
CREATE OR REPLACE FUNCTION public.engine_heartbeat(p jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid := (p->>'instance_id')::uuid; acquired boolean;
BEGIN
 INSERT INTO public.engine_control(id,instance_id,lease_until) VALUES(1,owner_id,now()+interval '90 seconds')
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,lease_until=EXCLUDED.lease_until WHERE engine_control.instance_id=owner_id OR engine_control.lease_until<now();
 acquired := FOUND;
 IF NOT acquired THEN RETURN false; END IF;
 INSERT INTO public.engine_health(id,instance_id,websocket_connected,binance_connected,available_symbols,status,error,runtime_mode) VALUES(1,owner_id,(p->>'websocket_connected')::boolean,(p->>'binance_connected')::boolean,(p->>'available_symbols')::integer,p->>'status',p->>'error',coalesce(p->>'runtime_mode','production'))
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,websocket_connected=EXCLUDED.websocket_connected,binance_connected=EXCLUDED.binance_connected,available_symbols=EXCLUDED.available_symbols,status=EXCLUDED.status,error=EXCLUDED.error,runtime_mode=EXCLUDED.runtime_mode,last_heartbeat_at=now();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.engine_heartbeat(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engine_heartbeat(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.stop_engine(p_instance uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE public.engine_control SET lease_until=now() WHERE id=1 AND instance_id=p_instance;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.engine_health SET status='STOPPED',websocket_connected=false,binance_connected=false,last_heartbeat_at=now() WHERE id=1 AND instance_id=p_instance;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.stop_engine(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.stop_engine(uuid) TO service_role;