DELETE FROM public.telegram_logs WHERE trade_id = 'NEARUSDT.P-L-1';
DELETE FROM public.signal_events WHERE trade_id = 'NEARUSDT.P-L-1';
DELETE FROM public.active_positions WHERE trade_id = 'NEARUSDT.P-L-1';
DELETE FROM public.webhook_receipts;