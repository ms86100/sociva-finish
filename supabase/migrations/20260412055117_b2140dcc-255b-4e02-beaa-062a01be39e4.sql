
CREATE OR REPLACE FUNCTION public.get_banner_analytics_daily()
RETURNS TABLE(
  event_date date,
  banner_id uuid,
  banner_title text,
  impressions bigint,
  clicks bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    DATE(ba.created_at) as event_date,
    ba.banner_id,
    fi.title as banner_title,
    COUNT(*) FILTER (WHERE ba.event_type = 'impression') as impressions,
    COUNT(*) FILTER (WHERE ba.event_type IN ('click','section_click','product_click')) as clicks
  FROM banner_analytics ba
  JOIN featured_items fi ON fi.id = ba.banner_id
  WHERE ba.created_at >= now() - interval '14 days'
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_banner_section_analytics()
RETURNS TABLE(
  banner_id uuid,
  section_id uuid,
  section_title text,
  impressions bigint,
  clicks bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ba.banner_id,
    ba.section_id,
    bs.title as section_title,
    COUNT(*) FILTER (WHERE ba.event_type = 'impression') as impressions,
    COUNT(*) FILTER (WHERE ba.event_type IN ('click','section_click','product_click')) as clicks
  FROM banner_analytics ba
  LEFT JOIN banner_sections bs ON bs.id = ba.section_id
  WHERE ba.section_id IS NOT NULL
  GROUP BY 1, 2, 3
  ORDER BY clicks DESC;
$$;
