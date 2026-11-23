-- Khatmitthi WhatsApp marketing autopilot
-- Operator inbox creatives (ready to forward). Meta Cloud API only.

CREATE TABLE IF NOT EXISTS public.khatmitthi_promo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  mode text,
  angle text,
  headline text,
  caption text,
  coupon_code text NOT NULL DEFAULT 'KHATMITTHI50',
  product_id uuid,
  product_name text,
  product_image_url text,
  creative_image_url text,
  image_source text,
  caption_hash text,
  image_hash text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  delivery_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  skip_reason text,
  error_message text,
  dry_run boolean NOT NULL DEFAULT false,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS khatmitthi_promo_runs_started_idx
  ON public.khatmitthi_promo_runs (started_at DESC);

CREATE INDEX IF NOT EXISTS khatmitthi_promo_runs_status_idx
  ON public.khatmitthi_promo_runs (status, started_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS khatmitthi_promo_runs_caption_hash_uidx
  ON public.khatmitthi_promo_runs (caption_hash)
  WHERE caption_hash IS NOT NULL AND status IN ('sent', 'shadow', 'partial');

ALTER TABLE public.khatmitthi_promo_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read khatmitthi_promo_runs" ON public.khatmitthi_promo_runs;
CREATE POLICY "Admins read khatmitthi_promo_runs"
  ON public.khatmitthi_promo_runs
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins update khatmitthi_promo_runs" ON public.khatmitthi_promo_runs;
CREATE POLICY "Admins update khatmitthi_promo_runs"
  ON public.khatmitthi_promo_runs
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.khatmitthi_promo_runs TO service_role;
GRANT SELECT ON public.khatmitthi_promo_runs TO authenticated;

INSERT INTO public.notification_config (key, value)
VALUES (
  'khatmitthi_whatsapp_promo',
  jsonb_build_object(
    'mode', 'shadow',
    'interval_minutes', 40,
    'timezone', 'Asia/Kolkata',
    'seller_id', 'a058a92e-11b7-4e37-ade1-e73132d6e578',
    'coupon_code', 'KHATMITTHI50',
    'offer_label', 'FLAT 50% OFF',
    'recipients', jsonb_build_array('919535115316', '9187351014'),
    'android_url', 'https://play.google.com/store/apps/details?id=app.sociva.community&hl=en_IN',
    'ios_url', 'https://apps.apple.com/in/app/sociva/id6759218504',
    'web_url', 'https://sociva.in',
    'provider', 'meta',
    'meta_template_name', null,
    'quiet_hours_start_ist', 0,
    'quiet_hours_end_ist', 7,
    'prefer_real_product_photos', true
  )
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

CREATE OR REPLACE FUNCTION public.fn_invoke_khatmitthi_promo()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text;
  v_worker_secret text;
BEGIN
  v_url := rtrim(coalesce(
    current_setting('app.settings.supabase_url', true),
    'https://kkzkuyhgdvyecmxtmkpy.supabase.co'
  ), '/') || '/functions/v1/send-khatmitthi-promo';

  SELECT decrypted_secret INTO v_worker_secret
  FROM vault.decrypted_secrets
  WHERE name = 'pnq_worker_secret'
  LIMIT 1;

  IF v_worker_secret IS NULL OR length(v_worker_secret) < 32 THEN
    RAISE WARNING 'fn_invoke_khatmitthi_promo: pnq_worker_secret missing - skip';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_worker_secret
    ),
    body := jsonb_build_object('trigger', 'cron', 'time', now())
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_invoke_khatmitthi_promo() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_invoke_khatmitthi_promo() TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid FROM cron.job
    WHERE jobname = 'khatmitthi_whatsapp_promo'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- Tick every 10 minutes UTC; edge function enforces 40-minute spacing in Asia/Kolkata.
SELECT cron.schedule(
  'khatmitthi_whatsapp_promo',
  '*/10 * * * *',
  $$SELECT public.fn_invoke_khatmitthi_promo();$$
);
