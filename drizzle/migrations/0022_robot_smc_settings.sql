ALTER TABLE public.robot_settings
  ADD COLUMN daily_loss_limit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN loss_streak_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN breakeven_trigger_roi_pct numeric NOT NULL DEFAULT 6 CHECK (breakeven_trigger_roi_pct >= 2 AND breakeven_trigger_roi_pct < 10),
  ADD COLUMN ote_min numeric NOT NULL DEFAULT 0.62 CHECK (ote_min >= 0.3 AND ote_min < 1),
  ADD COLUMN ote_max numeric NOT NULL DEFAULT 0.79 CHECK (ote_max > 0.3 AND ote_max <= 1);
ALTER TABLE public.robot_settings ADD CONSTRAINT robot_settings_ote_order CHECK (ote_max > ote_min);
COMMENT ON COLUMN public.robot_settings.risk_per_trade_pct IS 'Maximum loss at the structural stop, as % of balance; position size is reduced to respect it';
COMMENT ON COLUMN public.robot_settings.daily_loss_limit_pct IS 'Daily loss limit % of balance; applies only when daily_loss_limit_enabled';
COMMENT ON COLUMN public.robot_settings.loss_streak_cooldown IS 'Consecutive losses before a cooldown; applies only when loss_streak_enabled';

CREATE OR REPLACE FUNCTION public.robot_commit_verified(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; rt jsonb; d jsonb; strat text;
BEGIN
 result:=public.robot_commit_audited(p);
 IF coalesce((result->>'paused')::boolean,false) THEN RETURN result; END IF;
 rt:=p->'runtime';
 strat:=coalesce(rt->>'strategy','LIQUIDITY_SWEEP_V1');
 IF rt IS NOT NULL THEN
  INSERT INTO public.robot_runtime(id,instance_id,strategy,source_hash,git_commit,host_kind,runtime_mode,started_at,reported_at)
  VALUES(1,(p->>'instance_id')::uuid,rt->>'strategy',rt->>'source_hash',rt->>'git_commit',rt->>'host_kind',rt->>'runtime_mode',(rt->>'started_at')::timestamptz,now())
  ON CONFLICT(id) DO UPDATE SET instance_id=excluded.instance_id,strategy=excluded.strategy,source_hash=excluded.source_hash,git_commit=excluded.git_commit,host_kind=excluded.host_kind,runtime_mode=excluded.runtime_mode,started_at=excluded.started_at,reported_at=now();
 END IF;
 FOR d IN SELECT * FROM jsonb_array_elements(coalesce(p->'decisions','[]')) LOOP
  INSERT INTO public.robot_decisions(event_id,symbol,direction,strategy,source_hash,candle_time,phase,decision,reason,score,evidence)
  VALUES(d->>'event_id',d->>'symbol',d->>'direction',strat,d->>'source_hash',(d->>'candle_time')::timestamptz,d->>'phase',d->>'decision',d->>'reason',(d->>'score')::integer,d->'evidence') ON CONFLICT(event_id) DO NOTHING;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.robot_commit_verified(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.robot_commit_verified(jsonb) TO service_role;