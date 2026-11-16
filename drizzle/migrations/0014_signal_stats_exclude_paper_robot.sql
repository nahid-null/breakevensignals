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
 -- Paper robot receipts share the Telegram log but are not signal alerts.
 'telegramSent',(SELECT count(*) FROM public.telegram_logs l WHERE l.delivery_status='SENT' AND NOT l.is_test
   AND NOT EXISTS (SELECT 1 FROM public.robot_positions r WHERE r.id = l.trade_id)));
$$;
REVOKE ALL ON FUNCTION public.terminal_statistics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminal_statistics() TO anon,authenticated,service_role;