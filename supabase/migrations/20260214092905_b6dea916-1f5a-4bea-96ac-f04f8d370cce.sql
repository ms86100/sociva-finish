
-- ═══════════════════════════════════════════════════════════
-- FEATURE 1 & 2: Silent Confirmation + Security Mode Tiers
-- ═══════════════════════════════════════════════════════════

-- Add security_mode to societies (basic = QR only, confirmation = QR + resident approval, ai_match = future)
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS security_mode text NOT NULL DEFAULT 'basic';
ALTER TABLE public.societies ADD COLUMN IF NOT EXISTS security_confirmation_timeout_seconds integer NOT NULL DEFAULT 20;

-- Add confirmation fields to gate_entries
ALTER TABLE public.gate_entries ADD COLUMN IF NOT EXISTS awaiting_confirmation boolean NOT NULL DEFAULT false;
ALTER TABLE public.gate_entries ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz;
ALTER TABLE public.gate_entries ADD COLUMN IF NOT EXISTS confirmed_by_resident_at timestamptz;
ALTER TABLE public.gate_entries ADD COLUMN IF NOT EXISTS confirmation_denied_at timestamptz;

-- Index for guard polling on pending confirmations
CREATE INDEX IF NOT EXISTS idx_gate_entries_pending_confirmation
  ON public.gate_entries (society_id, awaiting_confirmation, confirmation_status)
  WHERE awaiting_confirmation = true;

-- Index for resident confirmation lookups
CREATE INDEX IF NOT EXISTS idx_gate_entries_resident_confirmation
  ON public.gate_entries (user_id, confirmation_status, created_at DESC)
  WHERE awaiting_confirmation = true;

-- Enable realtime for gate_entries (for guard polling)
ALTER PUBLICATION supabase_realtime ADD TABLE public.gate_entries;

-- ═══════════════════════════════════════════════════════════
-- FEATURE 5: Gate Entry Audit Dashboard
-- ═══════════════════════════════════════════════════════════

-- Composite index for audit queries with date range
CREATE INDEX IF NOT EXISTS idx_gate_entries_audit
  ON public.gate_entries (society_id, entry_time DESC, entry_type, confirmation_status);

-- Index for officer lookups
CREATE INDEX IF NOT EXISTS idx_gate_entries_verified_by
  ON public.gate_entries (verified_by, entry_time DESC);

-- RLS policy: society admins can view all gate entries for their society
CREATE POLICY "Society admins view gate entries"
  ON public.gate_entries
  FOR SELECT
  USING (
    public.is_society_admin(auth.uid(), society_id)
    OR public.is_security_officer(auth.uid(), society_id)
    OR user_id = auth.uid()
  );

-- Drop existing insert policy if any and recreate
DROP POLICY IF EXISTS "Security officers insert gate entries" ON public.gate_entries;
CREATE POLICY "Security officers insert gate entries"
  ON public.gate_entries
  FOR INSERT
  WITH CHECK (
    public.is_security_officer(auth.uid(), society_id)
  );

-- Allow security officers and residents to update confirmation status
DROP POLICY IF EXISTS "Update gate entry confirmation" ON public.gate_entries;
CREATE POLICY "Update gate entry confirmation"
  ON public.gate_entries
  FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_security_officer(auth.uid(), society_id)
    OR public.is_society_admin(auth.uid(), society_id)
  );

-- Validate security_mode values via trigger
CREATE OR REPLACE FUNCTION public.validate_security_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.security_mode NOT IN ('basic', 'confirmation', 'ai_match') THEN
    RAISE EXCEPTION 'Invalid security_mode: %. Must be basic, confirmation, or ai_match', NEW.security_mode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_security_mode_trigger ON public.societies;
CREATE TRIGGER validate_security_mode_trigger
  BEFORE INSERT OR UPDATE OF security_mode ON public.societies
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_security_mode();
