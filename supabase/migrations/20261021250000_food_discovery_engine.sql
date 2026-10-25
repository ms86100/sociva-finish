-- Fulfilment-honest daily food discovery.
-- Default mode is shadow: cron runs, selections are logged, no buyer pushes.

CREATE TABLE IF NOT EXISTS public.food_discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ist_date date NOT NULL,
  slot text NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'evening')),
  status text NOT NULL DEFAULT 'running',
  mode text,
  variant_id text,
  seller_id uuid,
  product_id uuid,
  title text,
  body text,
  destination text,
  fulfillment text,
  skip_reason text,
  targeted_count integer,
  queued_count integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS food_discovery_runs_once
  ON public.food_discovery_runs (ist_date, slot);

CREATE INDEX IF NOT EXISTS food_discovery_runs_started_idx
  ON public.food_discovery_runs (started_at DESC);

ALTER TABLE public.food_discovery_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read food_discovery_runs" ON public.food_discovery_runs;
CREATE POLICY "Admins read food_discovery_runs"
  ON public.food_discovery_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update food_discovery_runs" ON public.food_discovery_runs;
CREATE POLICY "Admins update food_discovery_runs"
  ON public.food_discovery_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.food_discovery_runs TO service_role;
GRANT SELECT ON public.food_discovery_runs TO authenticated;

INSERT INTO public.notification_config (key, value) VALUES (
  'food_discovery',
  jsonb_build_object(
    'mode', 'shadow',
    'timezone', 'Asia/Kolkata',
    'slots', jsonb_build_object(
      'breakfast', jsonb_build_object('hour', 10, 'minute', 15, 'enabled', true),
      'lunch', jsonb_build_object('hour', 11, 'minute', 15, 'enabled', true),
      'evening', jsonb_build_object('hour', 17, 'minute', 30, 'enabled', true)
    ),
    'max_per_user_per_day', 2,
    'max_per_user_per_week', 10,
    'min_hours_between', 4,
    'auto_include_food_stores', true,
    'seller_ids', jsonb_build_array(
      '3dac28c6-74dc-4b3f-bb85-614dc3b40794',
      '0a670c2b-f28a-4916-90cf-47fb1e9edbfa',
      '40829bcd-c028-4f30-94e1-b071092c59ae',
      '66eb3652-5fb0-4a70-abe6-fd5853530490',
      '63cc42c4-4704-48dc-ad7b-2eeeae42c70e',
      '6e73b27d-606b-4593-a685-0b8279d2452e'
    ),
    'exclude_seller_ids', '[]'::jsonb,
    'exclude_name_patterns', jsonb_build_array('qa', '[hold]', 'test product'),
    'society_ids', jsonb_build_array(
      '327fb699-542e-4ab6-b0b1-97022604bb88',
      'e3b1aa9b-d4e5-467c-b95e-13348129f426'
    )
  )
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.food_discovery_audience(p_society_ids uuid[])
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT dt.user_id
  FROM public.device_tokens dt
  JOIN public.profiles p ON p.id = dt.user_id
  LEFT JOIN public.notification_preferences np ON np.user_id = dt.user_id
  WHERE coalesce(dt.invalid, false) = false
    AND coalesce(np.promotions, true) = true
    AND (
      p.society_id = ANY (p_society_ids)
      OR EXISTS (
        SELECT 1
        FROM public.delivery_addresses da
        WHERE da.user_id = dt.user_id
          AND da.society_id = ANY (p_society_ids)
      )
    );
$$;

REVOKE ALL ON FUNCTION public.food_discovery_audience(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.food_discovery_audience(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_invoke_food_discovery(p_slot text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
BEGIN
  IF p_slot NOT IN ('breakfast', 'lunch', 'evening') THEN
    RAISE WARNING 'fn_invoke_food_discovery: invalid slot %', p_slot;
    RETURN;
  END IF;

  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/send-food-discovery';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_food_discovery: pnq_worker_secret missing - skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('slot', p_slot, 'trigger', 'cron', 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_food_discovery(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_food_discovery(text) TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'food_discovery_breakfast',
      'food_discovery_lunch',
      'food_discovery_evening'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- 10:15 IST = 04:45 UTC. India has no DST.
SELECT cron.schedule(
  'food_discovery_breakfast',
  '45 4 * * *',
  $$SELECT public.fn_invoke_food_discovery('breakfast');$$
);

-- 11:15 IST = 05:45 UTC
SELECT cron.schedule(
  'food_discovery_lunch',
  '45 5 * * *',
  $$SELECT public.fn_invoke_food_discovery('lunch');$$
);

-- 17:30 IST = 12:00 UTC
SELECT cron.schedule(
  'food_discovery_evening',
  '0 12 * * *',
  $$SELECT public.fn_invoke_food_discovery('evening');$$
);
