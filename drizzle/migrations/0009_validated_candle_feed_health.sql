ALTER TABLE public.engine_health ADD COLUMN feed_health jsonb;
CREATE OR REPLACE FUNCTION public.engine_heartbeat(p jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE owner_id uuid := (p->>'instance_id')::uuid; acquired boolean;
BEGIN
 INSERT INTO public.engine_control(id,instance_id,lease_until) VALUES(1,owner_id,now()+interval '90 seconds')
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,lease_until=EXCLUDED.lease_until WHERE engine_control.instance_id=owner_id OR engine_control.lease_until<now();
 acquired := FOUND;
 IF NOT acquired THEN RETURN false; END IF;
 INSERT INTO public.engine_health(id,instance_id,websocket_connected,binance_connected,available_symbols,status,error,runtime_mode,host_kind,started_at,uptime_seconds,scanned_symbols,last_scan_at,feed_health)
 VALUES(1,owner_id,(p->>'websocket_connected')::boolean,(p->>'binance_connected')::boolean,(p->>'available_symbols')::integer,p->>'status',p->>'error',coalesce(p->>'runtime_mode','production'),coalesce(p->>'host_kind','unknown'),(p->>'started_at')::timestamptz,coalesce((p->>'uptime_seconds')::bigint,0),coalesce((p->>'scanned_symbols')::integer,0),(p->>'last_scan_at')::timestamptz,nullif(p->'feed_health','null'::jsonb))
 ON CONFLICT(id) DO UPDATE SET instance_id=EXCLUDED.instance_id,websocket_connected=EXCLUDED.websocket_connected,binance_connected=EXCLUDED.binance_connected,available_symbols=EXCLUDED.available_symbols,status=EXCLUDED.status,error=EXCLUDED.error,runtime_mode=EXCLUDED.runtime_mode,host_kind=EXCLUDED.host_kind,started_at=EXCLUDED.started_at,uptime_seconds=EXCLUDED.uptime_seconds,scanned_symbols=EXCLUDED.scanned_symbols,last_scan_at=EXCLUDED.last_scan_at,feed_health=EXCLUDED.feed_health,last_heartbeat_at=now();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.engine_heartbeat(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.engine_heartbeat(jsonb) TO service_role;