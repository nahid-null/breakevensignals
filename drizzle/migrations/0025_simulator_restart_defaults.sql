CREATE OR REPLACE FUNCTION public.sim_change_balance(new_balance numeric, restart boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.sim_account; nb numeric;
BEGIN
 IF new_balance IS NULL OR new_balance<0 OR new_balance>1000000000 THEN RAISE EXCEPTION 'Invalid balance'; END IF;
 SELECT * INTO a FROM public.sim_account WHERE id=1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Simulator account missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.sim_trades WHERE status='OPEN') THEN RAISE EXCEPTION 'Wait for the open practice trade to finish before changing the balance'; END IF;
 nb:=CASE WHEN restart THEN 5 ELSE round(new_balance,2) END;
 INSERT INTO public.sim_balance_events(kind,balance_before,balance_after) VALUES(CASE WHEN restart THEN 'RESET' ELSE 'EDIT' END,a.balance,nb);
 UPDATE public.sim_account SET balance=nb,enabled=CASE WHEN restart THEN true ELSE enabled END,session_started_at=CASE WHEN restart THEN clock_timestamp() ELSE session_started_at END,updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('balance',nb);
END $$;
REVOKE ALL ON FUNCTION public.sim_change_balance(numeric,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sim_change_balance(numeric,boolean) TO service_role;