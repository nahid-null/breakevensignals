ALTER TABLE public.robot_account ALTER COLUMN balance SET DEFAULT 10, ALTER COLUMN start_balance SET DEFAULT 10, ALTER COLUMN total_deposited SET DEFAULT 10;

CREATE TABLE public.robot_capital_adjustments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 amount numeric NOT NULL,
 previous_start_balance numeric NOT NULL,
 new_start_balance numeric NOT NULL CHECK (new_start_balance > 0),
 balance_before numeric NOT NULL,
 balance_after numeric NOT NULL CHECK (balance_after >= 0),
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.robot_capital_adjustments TO anon, authenticated;
GRANT ALL ON public.robot_capital_adjustments TO service_role;
ALTER TABLE public.robot_capital_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read robot capital adjustments" ON public.robot_capital_adjustments FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.robot_correct_initial_balance(p_start numeric) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.robot_account; delta numeric;
BEGIN
 IF p_start IS NULL OR p_start <= 0 OR p_start > 1000000000 OR p_start = 'NaN'::numeric THEN RAISE EXCEPTION 'Invalid initial balance'; END IF;
 -- Serialize against worker commits, then deposits, before checking immutable trading history.
 PERFORM 1 FROM public.engine_control WHERE id = 1 FOR UPDATE;
 SELECT * INTO a FROM public.robot_account WHERE id = 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Paper robot account missing'; END IF;
 IF a.start_balance = p_start THEN RETURN a.balance; END IF;
 IF EXISTS (SELECT 1 FROM public.robot_positions) THEN RAISE EXCEPTION 'Cannot correct initial capital after recorded trades'; END IF;
 delta := p_start - a.start_balance;
 IF a.balance + delta < 0 OR a.total_deposited + delta < 0 THEN RAISE EXCEPTION 'Initial capital correction would make the account negative'; END IF;
 UPDATE public.robot_account SET balance = a.balance + delta, start_balance = p_start, total_deposited = a.total_deposited + delta, updated_at = now() WHERE id = 1;
 INSERT INTO public.robot_capital_adjustments(amount, previous_start_balance, new_start_balance, balance_before, balance_after, reason)
 VALUES (delta, a.start_balance, p_start, a.balance, a.balance + delta, 'User-requested initial paper allocation correction; deposits preserved');
 RETURN a.balance + delta;
END $$;
REVOKE ALL ON FUNCTION public.robot_correct_initial_balance(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.robot_correct_initial_balance(numeric) TO service_role;