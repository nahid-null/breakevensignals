ALTER TABLE public.robot_positions ADD COLUMN entry_audit jsonb, ADD COLUMN mae_roi_pct numeric, ADD COLUMN mfe_roi_pct numeric, ADD COLUMN funding_applied_at bigint NOT NULL DEFAULT 0;
ALTER TABLE public.robot_settings ADD COLUMN entry_max_age_ms integer NOT NULL DEFAULT 30000 CHECK(entry_max_age_ms BETWEEN 1000 AND 120000), ADD COLUMN quote_max_age_ms integer NOT NULL DEFAULT 5000 CHECK(quote_max_age_ms BETWEEN 500 AND 30000), ADD COLUMN max_entry_drift_atr numeric NOT NULL DEFAULT 0.2 CHECK(max_entry_drift_atr > 0 AND max_entry_drift_atr <= 1), ADD COLUMN min_sweep_atr numeric NOT NULL DEFAULT 0.05 CHECK(min_sweep_atr > 0), ADD COLUMN max_sweep_atr numeric NOT NULL DEFAULT 1.5 CHECK(max_sweep_atr > min_sweep_atr), ADD COLUMN min_rejection_wick numeric NOT NULL DEFAULT 0.35 CHECK(min_rejection_wick BETWEEN 0.1 AND 0.9), ADD COLUMN min_volume_ratio numeric NOT NULL DEFAULT 0.8 CHECK(min_volume_ratio BETWEEN 0.1 AND 5), ADD COLUMN min_reward_risk numeric NOT NULL DEFAULT 0.75 CHECK(min_reward_risk BETWEEN 0.1 AND 5), ADD COLUMN max_candle_atr numeric NOT NULL DEFAULT 1.5 CHECK(max_candle_atr BETWEEN 0.5 AND 5), ADD COLUMN sweep_max_age_minutes integer NOT NULL DEFAULT 20 CHECK(sweep_max_age_minutes BETWEEN 2 AND 60), ADD COLUMN symbols text[] CHECK(symbols IS NULL OR cardinality(symbols)=40);
CREATE OR REPLACE FUNCTION public.robot_commit_audited(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result jsonb; o jsonb; u jsonb;
BEGIN
 result := public.robot_commit(p);
 IF coalesce((result->>'paused')::boolean,false) THEN RETURN result; END IF;
 FOR o IN SELECT * FROM jsonb_array_elements(coalesce(p->'opens','[]')) LOOP
  IF result->'opened' ? (o->>'id') THEN
   UPDATE public.robot_positions SET entry_audit=o->'entry_audit', mae_roi_pct=(o->>'mae_roi_pct')::numeric, mfe_roi_pct=(o->>'mfe_roi_pct')::numeric, unrealized_pnl=coalesce((o->>'unrealized_pnl')::numeric,unrealized_pnl), net_roi_pct=(o->>'net_roi_pct')::numeric, funding_applied_at=coalesce((o->>'funding_applied_at')::bigint,0) WHERE id=o->>'id';
  END IF;
 END LOOP;
 FOR u IN SELECT * FROM jsonb_array_elements(coalesce(p->'updates','[]')) LOOP
  IF result->'applied' ? (u->>'id') THEN
   UPDATE public.robot_positions SET mae_roi_pct=CASE WHEN u->>'mae_roi_pct' IS NULL THEN mae_roi_pct ELSE least(mae_roi_pct,(u->>'mae_roi_pct')::numeric) END, mfe_roi_pct=CASE WHEN u->>'mfe_roi_pct' IS NULL THEN mfe_roi_pct ELSE greatest(mfe_roi_pct,(u->>'mfe_roi_pct')::numeric) END, funding_applied_at=greatest(funding_applied_at,coalesce((u->>'funding_applied_at')::bigint,0)) WHERE id=u->>'id';
  END IF;
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.robot_commit_audited(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.robot_commit_audited(jsonb) TO service_role;
COMMENT ON COLUMN public.robot_positions.entry_audit IS 'Contemporaneous signal/executable quote evidence. NULL for older trades; never fabricate or backfill live evidence.';