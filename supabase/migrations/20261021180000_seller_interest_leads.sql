-- Thin expression-of-interest queue for Talk to Sociva voice calls.
-- Transcripts, recordings, and analysis stay in Retell. This table only
-- stores contact details plus a Retell call id so admins can fetch the
-- conversation live and set up the store for the seller.

CREATE TABLE IF NOT EXISTS public.seller_interest_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  phone text NOT NULL,
  society_name text NOT NULL,
  society_id uuid REFERENCES public.societies(id) ON DELETE SET NULL,
  retell_call_id text,
  status text NOT NULL DEFAULT 'new',
  admin_notes text,
  linked_seller_profile_id uuid REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  ip_hash text,
  CONSTRAINT seller_interest_leads_name_len CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 80),
  CONSTRAINT seller_interest_leads_society_len CHECK (char_length(btrim(society_name)) BETWEEN 2 AND 120),
  CONSTRAINT seller_interest_leads_phone_fmt CHECK (phone ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT seller_interest_leads_status_ok CHECK (
    status IN ('new', 'in_review', 'store_setup', 'closed')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS seller_interest_leads_retell_call_id_uidx
  ON public.seller_interest_leads (retell_call_id)
  WHERE retell_call_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS seller_interest_leads_created_idx
  ON public.seller_interest_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS seller_interest_leads_status_created_idx
  ON public.seller_interest_leads (status, created_at DESC);

CREATE INDEX IF NOT EXISTS seller_interest_leads_phone_created_idx
  ON public.seller_interest_leads (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS seller_interest_leads_ip_hash_created_idx
  ON public.seller_interest_leads (ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_seller_interest_leads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seller_interest_leads_updated_at ON public.seller_interest_leads;
CREATE TRIGGER trg_seller_interest_leads_updated_at
  BEFORE UPDATE ON public.seller_interest_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_seller_interest_leads_updated_at();

ALTER TABLE public.seller_interest_leads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.seller_interest_leads FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.seller_interest_leads TO authenticated;
GRANT ALL ON public.seller_interest_leads TO service_role;

DROP POLICY IF EXISTS seller_interest_leads_admin_select ON public.seller_interest_leads;
CREATE POLICY seller_interest_leads_admin_select
  ON public.seller_interest_leads
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS seller_interest_leads_admin_update ON public.seller_interest_leads;
CREATE POLICY seller_interest_leads_admin_update
  ON public.seller_interest_leads
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
