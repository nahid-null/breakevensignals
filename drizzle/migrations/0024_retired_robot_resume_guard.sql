CREATE OR REPLACE FUNCTION public.guard_retired_robot_resume() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.enabled OR NOT NEW.emergency_stop THEN RAISE EXCEPTION 'Paper Robot is retired; new entries are disabled'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_retired_robot_resume() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_retired_robot_resume() TO service_role;
CREATE TRIGGER guard_retired_robot_resume BEFORE UPDATE OF enabled,emergency_stop ON public.robot_settings FOR EACH ROW EXECUTE FUNCTION public.guard_retired_robot_resume();
CREATE OR REPLACE FUNCTION public.robot_resume() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Paper Robot is retired; new entries are disabled'; END $$;
REVOKE ALL ON FUNCTION public.robot_resume() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.robot_resume() TO service_role;