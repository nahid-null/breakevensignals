-- prompt-81: SuperTrend (5 / hl2 / 1.6, 30m) continuous-reversal paper Simulator. Five dedicated coin slots
-- (NEAR, SUI, TAO, LINK, WLD) in ONE shared $10 cross-margin account, 5% of current main balance per trade, 75x.
-- A trade closes only on the opposite SuperTrend signal (then the reverse opens in the same slot) or a cross liquidation.
-- New tables only; the stopped crypto (CSTF) Simulator and all older history are untouched.
CREATE TABLE public.st_account (
  id integer PRIMARY KEY CHECK (id = 1),
  revision bigint NOT NULL DEFAULT 0,
  state jsonb,
  last_minute bigint,
  wallet numeric NOT NULL DEFAULT 10,
  main_balance numeric NOT NULL DEFAULT 10,
  equity numeric NOT NULL DEFAULT 10,
  maintenance numeric NOT NULL DEFAULT 0,
  open_count integer NOT NULL DEFAULT 0,
  liquidations integer NOT NULL DEFAULT 0,
  coins jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'WAITING_FOR_WORKER',
  error text,
  started_at timestamptz,
  checked_at timestamptz,
  stopped_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.st_account TO service_role;
ALTER TABLE public.st_account ENABLE ROW LEVEL SECURITY;
INSERT INTO public.st_account(id) VALUES (1);

CREATE TABLE public.st_trades (
  trade_id text PRIMARY KEY,
  symbol text NOT NULL CHECK (symbol IN ('NEARUSDT','SUIUSDT','TAOUSDT','LINKUSDT','WLDUSDT')),
  side text NOT NULL CHECK (side IN ('LONG','SHORT')),
  signal_time timestamptz NOT NULL, entry_time timestamptz NOT NULL,
  entry_price numeric NOT NULL, quantity numeric NOT NULL, margin numeric NOT NULL, leverage integer NOT NULL DEFAULT 75,
  entry_fee numeric NOT NULL, liquidation_price numeric NOT NULL,
  funding numeric NOT NULL DEFAULT 0, mark_price numeric, unrealized numeric,
  reversed_from text, reversed_to text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  exit_reason text CHECK (exit_reason IN ('OPPOSITE_SIGNAL','LIQUIDATED')), exit_time timestamptz, exit_price numeric,
  gross numeric, exit_fee numeric, net numeric, wallet_after numeric, main_after numeric, closed_mode text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.st_trades TO service_role;
ALTER TABLE public.st_trades ENABLE ROW LEVEL SECURITY;
CREATE INDEX st_trades_entry_time ON public.st_trades(entry_time DESC);
-- One active position per coin, enforced by the database.
CREATE UNIQUE INDEX st_trades_one_open_per_coin ON public.st_trades(symbol) WHERE status = 'OPEN';

CREATE TABLE public.st_signals (
  signal_id text PRIMARY KEY,
  symbol text NOT NULL, side text NOT NULL, signal_time timestamptz NOT NULL,
  decision text NOT NULL, reason text, mode text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.st_signals TO service_role;
ALTER TABLE public.st_signals ENABLE ROW LEVEL SECURITY;
CREATE INDEX st_signals_time ON public.st_signals(signal_time DESC);

CREATE TRIGGER guard_market_st_account BEFORE INSERT OR UPDATE ON public.st_account FOR EACH ROW EXECUTE FUNCTION public.guard_restricted_market_write();

CREATE OR REPLACE FUNCTION public.st_commit(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.st_account; e jsonb; cfg public.app_settings; n integer; ids text[];
BEGIN
 IF EXISTS (SELECT 1 FROM public.st_account WHERE id=1 AND stopped_at IS NOT NULL) THEN
  RETURN jsonb_build_object('conflict',false,'stopped',true,'revision',(SELECT revision FROM public.st_account WHERE id=1));
 END IF;
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Engine lease expired'; END IF;
 SELECT * INTO a FROM public.st_account WHERE id=1 FOR UPDATE;
 IF a.revision<>(p->>'expected_revision')::bigint THEN RETURN jsonb_build_object('conflict',true,'revision',a.revision); END IF;
 IF (a.last_minute IS NULL AND a.state IS NOT NULL) OR (a.last_minute IS NOT NULL AND (p->>'first_minute')::bigint<>a.last_minute+60000) THEN RAISE EXCEPTION 'Simulator minutes out of order'; END IF;
 IF (p->'state'->>'lastMinute')::bigint < (p->>'first_minute')::bigint THEN RAISE EXCEPTION 'Simulator batch has no minutes'; END IF;
 SELECT * INTO cfg FROM public.app_settings WHERE id=1;
 -- Closes first (a reversal frees the coin's slot before the reverse trade opens).
 FOR e IN SELECT value FROM jsonb_array_elements(p->'closed') LOOP
  UPDATE public.st_trades SET status='CLOSED',exit_reason=e->>'reason',exit_time=to_timestamp((e->>'exit_time')::bigint/1000.0),exit_price=(e->>'exit_price')::numeric,
   gross=(e->>'gross')::numeric,exit_fee=(e->>'exit_fee')::numeric,funding=(e->>'funding')::numeric,net=(e->>'net')::numeric,wallet_after=(e->>'wallet_after')::numeric,
   main_after=(e->>'main_after')::numeric,reversed_to=e->>'reversed_to',closed_mode=e->>'mode',mark_price=NULL,unrealized=NULL,updated_at=now()
   WHERE trade_id=e->>'trade_id' AND status='OPEN';
  GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Closed Simulator trade % is not open', e->>'trade_id'; END IF;
  IF coalesce(cfg.telegram_enabled,false) AND (e->>'notify')::boolean THEN
   INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message,created_at)
   SELECT e->>'trade_id'||'-st-result',e->>'trade_id',t.symbol,t.side,e->>'message',clock_timestamp() FROM public.st_trades t WHERE t.trade_id=e->>'trade_id'
   ON CONFLICT(event_id) DO NOTHING;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'opened') LOOP
  INSERT INTO public.st_trades(trade_id,symbol,side,signal_time,entry_time,entry_price,quantity,margin,entry_fee,liquidation_price,reversed_from)
  VALUES(e->>'trade_id',e->>'symbol',e->>'side',to_timestamp((e->>'signal_time')::bigint/1000.0),to_timestamp((e->>'entry_time')::bigint/1000.0),
   (e->>'entry_price')::numeric,(e->>'quantity')::numeric,(e->>'margin')::numeric,(e->>'entry_fee')::numeric,(e->>'liquidation_price')::numeric,e->>'reversed_from');
  IF coalesce(cfg.telegram_enabled,false) THEN
   INSERT INTO public.telegram_logs(event_id,trade_id,symbol,direction,message,created_at)
   VALUES(e->>'trade_id'||'-st-open',e->>'trade_id',e->>'symbol',e->>'side',e->>'message',clock_timestamp()) ON CONFLICT(event_id) DO NOTHING;
  END IF;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'signals') LOOP
  INSERT INTO public.st_signals(signal_id,symbol,side,signal_time,decision,reason,mode)
  VALUES(e->>'signal_id',e->>'symbol',e->>'side',to_timestamp((e->>'signal_time')::bigint/1000.0),e->>'decision',e->>'reason',e->>'mode')
  ON CONFLICT(signal_id) DO NOTHING;
 END LOOP;
 FOR e IN SELECT value FROM jsonb_array_elements(p->'open') LOOP
  UPDATE public.st_trades SET liquidation_price=(e->>'liquidation_price')::numeric,funding=(e->>'funding')::numeric,
   mark_price=(e->>'mark_price')::numeric,unrealized=(e->>'unrealized')::numeric,updated_at=now() WHERE trade_id=e->>'trade_id' AND status='OPEN';
 END LOOP;
 SELECT array_agg(x->>'id' ORDER BY x->>'id') INTO ids FROM jsonb_array_elements(p->'state'->'positions') x;
 IF coalesce(ids,'{}')<>coalesce((SELECT array_agg(trade_id ORDER BY trade_id) FROM public.st_trades WHERE status='OPEN'),'{}') THEN
  RAISE EXCEPTION 'Simulator open positions out of sync';
 END IF;
 UPDATE public.st_account SET revision=a.revision+1,state=p->'state',last_minute=(p->'state'->>'lastMinute')::bigint,wallet=(p->'state'->>'wallet')::numeric,
  main_balance=(p->'state'->>'wallet')::numeric+coalesce((SELECT sum((x->>'entryFee')::numeric+(x->>'funding')::numeric) FROM jsonb_array_elements(p->'state'->'positions') x),0),
  equity=(p->>'equity')::numeric,maintenance=(p->>'maintenance')::numeric,open_count=jsonb_array_length(p->'state'->'positions'),
  liquidations=(p->'state'->>'liquidations')::integer,coins=CASE WHEN jsonb_array_length(p->'coins')>0 THEN p->'coins' ELSE a.coins END,
  status=CASE WHEN p->>'mode'='live' THEN 'RUNNING' ELSE 'CATCHING_UP' END,error=NULL,started_at=coalesce(a.started_at,to_timestamp((p->>'first_minute')::bigint/1000.0)),
  checked_at=now(),updated_at=now() WHERE id=1;
 RETURN jsonb_build_object('conflict',false,'revision',a.revision+1);
END $$;
REVOKE ALL ON FUNCTION public.st_commit(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.st_commit(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.st_report_status(p jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.st_account WHERE id=1 AND stopped_at IS NOT NULL) THEN RETURN false; END IF;
 PERFORM 1 FROM public.engine_control WHERE id=1 AND instance_id=(p->>'instance_id')::uuid AND lease_until>now();
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE public.st_account SET status=left(p->>'status',30),error=left(p->>'error',400),checked_at=now() WHERE id=1;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.st_report_status(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.st_report_status(jsonb) TO service_role;