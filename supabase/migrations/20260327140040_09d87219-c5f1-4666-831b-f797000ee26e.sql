
ALTER TABLE public.seller_profiles 
  ADD COLUMN IF NOT EXISTS manual_override text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_override_until timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.seller_profiles.manual_override IS 'Force store open/closed regardless of schedule. Values: open, closed, NULL (use schedule)';
COMMENT ON COLUMN public.seller_profiles.manual_override_until IS 'When the manual override expires and reverts to schedule-based availability';
