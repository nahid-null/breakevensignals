CREATE OR REPLACE FUNCTION public.guard_restricted_market_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 PERFORM 1 FROM public.engine_control WHERE id=1 FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.engine_health WHERE id=1 AND (error LIKE 'BINANCE_ACCESS_RESTRICTED:%' OR error LIKE 'BINANCE_IP_BANNED:%')) THEN
  RAISE EXCEPTION 'Market processing paused: Binance access blocked';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_restricted_market_write() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_restricted_market_write() TO service_role;
CREATE TRIGGER guard_market_checkpoint BEFORE INSERT OR UPDATE ON public.engine_checkpoints FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_market_write();
CREATE TRIGGER guard_market_price BEFORE INSERT OR UPDATE ON public.market_state FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_market_write();
CREATE TRIGGER guard_market_position BEFORE INSERT OR UPDATE ON public.active_positions FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_market_write();
CREATE TRIGGER guard_market_signal BEFORE INSERT OR UPDATE ON public.signal_events FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_market_write();
CREATE OR REPLACE FUNCTION public.claim_telegram_delivery(log_id uuid, claim_id uuid) RETURNS SETOF public.telegram_logs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE test_notification boolean;
BEGIN
 SELECT is_test INTO test_notification FROM public.telegram_logs WHERE id=log_id;
 IF NOT coalesce(test_notification,false) THEN
  PERFORM 1 FROM public.engine_control WHERE id=1 FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.engine_health WHERE id=1 AND (error LIKE 'BINANCE_ACCESS_RESTRICTED:%' OR error LIKE 'BINANCE_IP_BANNED:%')) THEN RETURN; END IF;
 END IF;
 RETURN QUERY UPDATE public.telegram_logs SET delivery_claim=claim_id,claimed_at=now(),retry_count=retry_count+1,updated_at=now()
 WHERE id=log_id AND delivery_status<>'SENT' AND delivery_claim IS NULL AND NOT delivery_uncertain AND (next_retry_at IS NULL OR next_retry_at<=now()) RETURNING *;
END $$;
COMMENT ON FUNCTION public.guard_restricted_market_write() IS 'Serializes future market writes with engine heartbeat/lease updates and refuses recorded 451/418 pauses without modifying existing history.';
COMMENT ON FUNCTION public.claim_telegram_delivery(uuid,uuid) IS 'Claims unsent eligible notifications atomically; recorded Binance restrictions block signal claims but not explicit test notifications.';