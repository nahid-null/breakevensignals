CREATE TABLE public.robot_runtime (id integer PRIMARY KEY CHECK(id=1), instance_id uuid NOT NULL, strategy text NOT NULL, source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'), git_commit text, host_kind text NOT NULL, runtime_mode text NOT NULL, started_at timestamptz NOT NULL, reported_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.robot_runtime TO anon,authenticated;
GRANT ALL ON public.robot_runtime TO service_role;
ALTER TABLE public.robot_runtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public robot version evidence" ON public.robot_runtime FOR SELECT TO anon,authenticated USING(true);
CREATE TABLE public.robot_decisions (event_id text PRIMARY KEY, symbol text NOT NULL, direction text NOT NULL CHECK(direction IN ('LONG','SHORT')), strategy text NOT NULL, source_hash text NOT NULL, candle_time timestamptz NOT NULL, phase text NOT NULL CHECK(phase IN ('EVALUATION','EXECUTION')), decision text NOT NULL CHECK(decision IN ('QUALIFIED','TAKEN','SKIPPED','REJECTED')), reason text NOT NULL, score integer, evidence jsonb, received_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.robot_decisions TO anon,authenticated;
GRANT ALL ON public.robot_decisions TO service_role;
ALTER TABLE public.robot_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public paper decision log" ON public.robot_decisions FOR SELECT TO anon,authenticated USING(true);
CREATE INDEX robot_decisions_latest ON public.robot_decisions(received_at DESC);
CREATE INDEX robot_decisions_candle ON public.robot_decisions(candle_time DESC,symbol,direction);
CREATE OR REPLACE FUNCTION public.robot_commit_verified(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; rt jsonb; d jsonb;
BEGIN
 result:=public.robot_commit_audited(p);
 IF coalesce((result->>'paused')::boolean,false) THEN RETURN result; END IF;
 rt:=p->'runtime';
 IF rt IS NOT NULL THEN
  INSERT INTO public.robot_runtime(id,instance_id,strategy,source_hash,git_commit,host_kind,runtime_mode,started_at,reported_at)
  VALUES(1,(p->>'instance_id')::uuid,rt->>'strategy',rt->>'source_hash',rt->>'git_commit',rt->>'host_kind',rt->>'runtime_mode',(rt->>'started_at')::timestamptz,now())
  ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id,strategy=excluded.strategy,source_hash=excluded.source_hash,git_commit=excluded.git_commit,host_kind=excluded.host_kind,runtime_mode=excluded.runtime_mode,started_at=excluded.started_at,reported_at=now();
 END IF;
 FOR d IN SELECT * FROM jsonb_array_elements(coalesce(p->'decisions','[]')) LOOP
  INSERT INTO public.robot_decisions(event_id,symbol,direction,strategy,source_hash,candle_time,phase,decision,reason,score,evidence)
  VALUES(d->>'event_id',d->>'symbol',d->>'direction','LIQUIDITY_SWEEP_V1',d->>'source_hash',(d->>'candle_time')::timestamptz,d->>'phase',d->>'decision',d->>'reason',(d->>'score')::integer,d->'evidence') ON CONFLICT(event_id) DO NOTHING;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.robot_commit_verified(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.robot_commit_verified(jsonb) TO service_role;