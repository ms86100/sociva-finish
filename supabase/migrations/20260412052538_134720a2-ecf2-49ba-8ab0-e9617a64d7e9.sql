
-- 1. Add status column to featured_items
ALTER TABLE public.featured_items
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_featured_items_status ON public.featured_items(status);

-- 2. Admin RLS for festival_seller_participation
CREATE POLICY "admin_read_festival_participation"
  ON public.festival_seller_participation
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- 3. Admin RLS for banner_analytics (read)
CREATE POLICY "admin_read_banner_analytics"
  ON public.banner_analytics
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- 4. Server-side active banners resolver
CREATE OR REPLACE FUNCTION public.active_banners_for_society(p_society_id uuid DEFAULT NULL)
RETURNS SETOF public.featured_items
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
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
$$;

-- 5. Banner analytics summary RPC for admin dashboard
CREATE OR REPLACE FUNCTION public.get_banner_analytics_summary(p_banner_id uuid DEFAULT NULL)
RETURNS TABLE(
  banner_id uuid,
  banner_title text,
  impressions bigint,
  clicks bigint,
  section_clicks bigint,
  product_clicks bigint,
  unique_viewers bigint,
  ctr numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    fi.id AS banner_id,
    fi.title AS banner_title,
    COUNT(*) FILTER (WHERE ba.event_type = 'impression') AS impressions,
    COUNT(*) FILTER (WHERE ba.event_type = 'click') AS clicks,
    COUNT(*) FILTER (WHERE ba.event_type = 'section_click') AS section_clicks,
    COUNT(*) FILTER (WHERE ba.event_type = 'product_click') AS product_clicks,
    COUNT(DISTINCT ba.user_id) FILTER (WHERE ba.event_type = 'impression') AS unique_viewers,
    CASE
      WHEN COUNT(*) FILTER (WHERE ba.event_type = 'impression') = 0 THEN 0
      ELSE ROUND(
        COUNT(*) FILTER (WHERE ba.event_type IN ('click', 'section_click', 'product_click'))::numeric
        / COUNT(*) FILTER (WHERE ba.event_type = 'impression')::numeric * 100, 2
      )
    END AS ctr
  FROM public.featured_items fi
  LEFT JOIN public.banner_analytics ba ON ba.banner_id = fi.id
  WHERE (p_banner_id IS NULL OR fi.id = p_banner_id)
  GROUP BY fi.id, fi.title
  ORDER BY impressions DESC;
$$;
