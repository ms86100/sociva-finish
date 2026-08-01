
-- 1. Fix get_effective_society_features: sfo.feature_key doesn't exist, must join on feature_id
CREATE OR REPLACE FUNCTION public.get_effective_society_features(_society_id uuid)
RETURNS TABLE(feature_key text, display_name text, is_enabled boolean, source text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT pf.feature_key, pf.display_name,
         COALESCE(sfo.is_enabled, true)::boolean,
         CASE WHEN sfo.id IS NOT NULL THEN 'override' ELSE 'package' END::text
  FROM platform_features pf
  JOIN feature_package_items fpi ON fpi.feature_id = pf.id
  JOIN feature_packages fp ON fp.id = fpi.package_id
  LEFT JOIN builder_feature_packages bfp ON bfp.package_id = fp.id
  LEFT JOIN builder_societies bs ON bs.builder_id = bfp.builder_id AND bs.society_id = _society_id
  LEFT JOIN society_feature_overrides sfo ON sfo.society_id = _society_id AND sfo.feature_id = pf.id
  WHERE pf.is_active = true AND (fp.is_default = true OR bs.society_id IS NOT NULL);
END;
$$;

-- 2. Fix active_banners_for_society: STABLE function cannot do UPDATE, change to VOLATILE
CREATE OR REPLACE FUNCTION public.active_banners_for_society(p_society_id uuid DEFAULT NULL)
RETURNS SETOF public.featured_items
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.featured_items
  SET status = 'expired', is_active = false
  WHERE schedule_end IS NOT NULL
    AND schedule_end < now()
    AND status = 'published'
    AND is_active = true;

  RETURN QUERY
  SELECT *
  FROM public.featured_items
  WHERE is_active = true
    AND status = 'published'
    AND (schedule_start IS NULL OR schedule_start <= now())
    AND (schedule_end IS NULL OR schedule_end >= now())
    AND (
      p_society_id IS NULL
      OR target_society_ids = '{}'
      OR p_society_id = ANY(target_society_ids)
      OR society_id = p_society_id
      OR society_id IS NULL
    )
  ORDER BY display_order ASC;
END;
$$;

-- 3. Add acknowledged_at to snag_tickets
ALTER TABLE public.snag_tickets ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- 4. Add missing composite indexes for hot query paths
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read_created
  ON public.user_notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_bookings_seller_date
  ON public.service_bookings (seller_id, booking_date, start_time);

CREATE INDEX IF NOT EXISTS idx_service_bookings_buyer_date
  ON public.service_bookings (buyer_id, booking_date, start_time);

CREATE INDEX IF NOT EXISTS idx_service_slots_product_date
  ON public.service_slots (product_id, slot_date, start_time)
  WHERE is_blocked = false;
