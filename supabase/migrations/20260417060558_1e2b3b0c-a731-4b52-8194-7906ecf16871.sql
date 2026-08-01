
ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS upi_holder_name text,
  ADD COLUMN IF NOT EXISTS upi_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS upi_provider text,
  ADD COLUMN IF NOT EXISTS upi_verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (upi_verification_status IN ('unverified','valid','invalid','stale','unavailable'));

CREATE TABLE IF NOT EXISTS public.upi_validation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  seller_id uuid,
  vpa text NOT NULL,
  status text NOT NULL,
  customer_name text,
  provider text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upi_logs_user_created
  ON public.upi_validation_logs(user_id, created_at DESC);

ALTER TABLE public.upi_validation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own upi logs" ON public.upi_validation_logs;
CREATE POLICY "Users can view own upi logs"
  ON public.upi_validation_logs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all upi logs" ON public.upi_validation_logs;
CREATE POLICY "Admins can view all upi logs"
  ON public.upi_validation_logs FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.reset_upi_verification_on_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(NEW.upi_id, '') <> COALESCE(OLD.upi_id, '')
  THEN
    IF NEW.upi_verification_status = 'valid'
       AND (NEW.upi_verified_at IS NULL
            OR NEW.upi_verified_at = OLD.upi_verified_at)
    THEN
      NEW.upi_verification_status := 'unverified';
      NEW.upi_holder_name := NULL;
      NEW.upi_verified_at := NULL;
      NEW.upi_provider := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_upi_verification ON public.seller_profiles;
CREATE TRIGGER trg_reset_upi_verification
  BEFORE UPDATE ON public.seller_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.reset_upi_verification_on_change();

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.mark_stale_upi_verifications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.seller_profiles
  SET upi_verification_status = 'stale'
  WHERE upi_verification_status = 'valid'
    AND upi_verified_at IS NOT NULL
    AND upi_verified_at < now() - interval '30 days';
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('mark-stale-upi-verifications');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mark-stale-upi-verifications',
  '30 2 * * *',
  $$SELECT public.mark_stale_upi_verifications();$$
);
