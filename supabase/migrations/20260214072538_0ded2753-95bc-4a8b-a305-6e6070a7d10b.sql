
-- =============================================
-- COMPOSITE INDEXES FOR SCALE (1M+ users)
-- =============================================

-- Orders: buyer order history (cursor pagination)
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created 
ON public.orders (buyer_id, created_at DESC);

-- Orders: seller dashboard (status filter + cursor)
CREATE INDEX IF NOT EXISTS idx_orders_seller_status_created 
ON public.orders (seller_id, status, created_at DESC);

-- Orders: admin/society dashboard
CREATE INDEX IF NOT EXISTS idx_orders_society_status_created 
ON public.orders (society_id, status, created_at DESC);

-- Chat messages: loading by order
CREATE INDEX IF NOT EXISTS idx_chat_messages_order_created 
ON public.chat_messages (order_id, created_at);

-- User notifications: inbox query
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read_created 
ON public.user_notifications (user_id, is_read, created_at DESC);

-- Products: seller product listing
CREATE INDEX IF NOT EXISTS idx_products_seller_available 
ON public.products (seller_id, is_available);

-- Society activity: feed loading
CREATE INDEX IF NOT EXISTS idx_society_activity_society_created 
ON public.society_activity (society_id, created_at DESC);

-- Bulletin posts: society feed
CREATE INDEX IF NOT EXISTS idx_bulletin_posts_society_archived_created 
ON public.bulletin_posts (society_id, is_archived, created_at DESC);

-- Audit log: society audit trail
CREATE INDEX IF NOT EXISTS idx_audit_log_society_created 
ON public.audit_log (society_id, created_at DESC);

-- Reviews: seller rating queries
CREATE INDEX IF NOT EXISTS idx_reviews_seller_hidden 
ON public.reviews (seller_id, is_hidden);

-- Seller profiles: society + verification (homepage queries)
CREATE INDEX IF NOT EXISTS idx_seller_profiles_society_verified 
ON public.seller_profiles (society_id, verification_status);

-- Dispute tickets: society dashboard
CREATE INDEX IF NOT EXISTS idx_dispute_tickets_society_status 
ON public.dispute_tickets (society_id, status);

-- Snag tickets: society dashboard
CREATE INDEX IF NOT EXISTS idx_snag_tickets_society_status 
ON public.snag_tickets (society_id, status);

-- =============================================
-- STATEMENT TIMEOUT ON HIGH-RISK FUNCTIONS
-- =============================================

-- Add statement_timeout to calculate_society_trust_score (12+ subqueries)
CREATE OR REPLACE FUNCTION public.calculate_society_trust_score(_society_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout = '5s'
AS $function$
DECLARE
  _vibrancy numeric;
  _transparency numeric;
  _governance numeric;
  _community numeric;
  _total numeric;
  _skill_count integer;
  _help_answered integer;
  _finance_entries integer;
  _milestone_entries integer;
  _doc_count integer;
  _qa_total integer;
  _qa_answered integer;
  _delay_explained integer;
  _tower_total integer;
  _dispute_total integer;
  _dispute_resolved integer;
  _snag_total integer;
  _snag_resolved integer;
  _bulletin_engagement integer;
BEGIN
  SELECT COUNT(*) INTO _skill_count
  FROM skill_listings WHERE society_id = _society_id AND created_at > now() - interval '30 days';

  SELECT COUNT(*) INTO _help_answered
  FROM help_responses hr
  JOIN help_requests hreq ON hreq.id = hr.request_id
  WHERE hreq.society_id = _society_id AND hr.created_at > now() - interval '30 days';

  _vibrancy := (LEAST(_skill_count, 10) + LEAST(_help_answered, 10)) / 20.0 * 2.5;

  SELECT COUNT(*) INTO _finance_entries
  FROM society_expenses WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _milestone_entries
  FROM construction_milestones WHERE society_id = _society_id AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _doc_count
  FROM project_documents WHERE society_id = _society_id;

  SELECT COUNT(*) INTO _tower_total FROM project_towers WHERE society_id = _society_id;
  SELECT COUNT(*) INTO _delay_explained
  FROM project_towers WHERE society_id = _society_id AND revised_completion IS NOT NULL AND delay_reason IS NOT NULL;

  SELECT COUNT(*) INTO _qa_total FROM project_questions WHERE society_id = _society_id;
  SELECT COUNT(*) INTO _qa_answered FROM project_questions WHERE society_id = _society_id AND is_answered = true;

  _transparency := (
    LEAST(_finance_entries, 20) / 20.0 * 0.5 +
    LEAST(_milestone_entries, 10) / 10.0 * 0.5 +
    LEAST(_doc_count, 10) / 10.0 * 0.5 +
    CASE WHEN _tower_total > 0 THEN (_delay_explained::numeric / _tower_total) * 0.5 ELSE 0.25 END +
    CASE WHEN _qa_total > 0 THEN (_qa_answered::numeric / _qa_total) * 0.5 ELSE 0.25 END
  ) * 2.5;

  SELECT COUNT(*) INTO _dispute_total
  FROM dispute_tickets WHERE society_id = _society_id AND created_at > now() - interval '90 days';
  SELECT COUNT(*) INTO _dispute_resolved
  FROM dispute_tickets WHERE society_id = _society_id AND status IN ('resolved', 'closed') AND created_at > now() - interval '90 days';

  SELECT COUNT(*) INTO _snag_total
  FROM snag_tickets WHERE society_id = _society_id AND created_at > now() - interval '90 days';
  SELECT COUNT(*) INTO _snag_resolved
  FROM snag_tickets WHERE society_id = _society_id AND status IN ('fixed', 'verified', 'closed') AND created_at > now() - interval '90 days';

  IF (_dispute_total + _snag_total) > 0 THEN
    _governance := ((_dispute_resolved + _snag_resolved)::numeric / (_dispute_total + _snag_total)) * 2.5;
  ELSE
    _governance := 1.25;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN bp.created_at > now() - interval '30 days' THEN 1 ELSE 0 END), 0) +
    COALESCE((SELECT COUNT(*) FROM bulletin_comments bc JOIN bulletin_posts bp2 ON bp2.id = bc.post_id WHERE bp2.society_id = _society_id AND bc.created_at > now() - interval '30 days'), 0) +
    COALESCE((SELECT COUNT(*) FROM bulletin_votes bv JOIN bulletin_posts bp3 ON bp3.id = bv.post_id WHERE bp3.society_id = _society_id AND bv.created_at > now() - interval '30 days'), 0)
  INTO _bulletin_engagement
  FROM bulletin_posts bp WHERE bp.society_id = _society_id;

  _community := LEAST(_bulletin_engagement, 50) / 50.0 * 2.5;

  _total := ROUND(_vibrancy + _transparency + _governance + _community, 1);
  RETURN LEAST(_total, 10.0);
END;
$function$;

-- Add statement_timeout to search_marketplace (complex joins)
CREATE OR REPLACE FUNCTION public.search_marketplace(search_term text, user_society_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(seller_id uuid, business_name text, description text, cover_image_url text, profile_image_url text, rating numeric, total_reviews integer, categories text[], primary_group text, is_available boolean, is_featured boolean, availability_start time without time zone, availability_end time without time zone, user_id uuid, matching_products jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout = '5s'
AS $function$
BEGIN
  RETURN QUERY
  SELECT DISTINCT 
    sp.id as seller_id,
    sp.business_name,
    sp.description,
    sp.cover_image_url,
    sp.profile_image_url,
    sp.rating,
    sp.total_reviews,
    sp.categories,
    sp.primary_group,
    sp.is_available,
    sp.is_featured,
    sp.availability_start,
    sp.availability_end,
    sp.user_id,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 
        'name', p.name, 
        'price', p.price,
        'image_url', p.image_url,
        'category', p.category,
        'is_veg', p.is_veg
      ))
      FROM products p
      WHERE p.seller_id = sp.id 
        AND p.is_available = true
        AND (
          p.name ILIKE '%' || search_term || '%' 
          OR p.description ILIKE '%' || search_term || '%'
        )
    ) as matching_products
  FROM seller_profiles sp
  LEFT JOIN products p ON p.seller_id = sp.id AND p.is_available = true
  WHERE sp.verification_status = 'approved'
    AND (user_society_id IS NULL OR sp.society_id = user_society_id)
    AND (
      sp.business_name ILIKE '%' || search_term || '%'
      OR sp.description ILIKE '%' || search_term || '%'
      OR p.name ILIKE '%' || search_term || '%'
      OR p.description ILIKE '%' || search_term || '%'
    )
  GROUP BY sp.id, sp.business_name, sp.description, sp.cover_image_url, 
           sp.profile_image_url, sp.rating, sp.total_reviews, sp.categories,
           sp.primary_group, sp.is_available, sp.is_featured, 
           sp.availability_start, sp.availability_end, sp.user_id
  ORDER BY sp.is_featured DESC, sp.rating DESC;
END;
$function$;

-- Add statement_timeout to get_user_auth_context
CREATE OR REPLACE FUNCTION public.get_user_auth_context(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout = '5s'
AS $function$
DECLARE
  _result jsonb;
  _profile jsonb;
  _society jsonb;
  _roles jsonb;
  _seller_profiles jsonb;
  _society_admin jsonb;
  _builder_ids jsonb;
BEGIN
  SELECT to_jsonb(p.*) INTO _profile
  FROM profiles p WHERE p.id = _user_id;

  IF _profile IS NULL THEN
    RETURN jsonb_build_object('profile', null);
  END IF;

  IF (_profile->>'society_id') IS NOT NULL THEN
    SELECT to_jsonb(s.*) INTO _society
    FROM societies s WHERE s.id = (_profile->>'society_id')::uuid;

    SELECT to_jsonb(sa.*) INTO _society_admin
    FROM society_admins sa
    WHERE sa.user_id = _user_id AND sa.society_id = (_profile->>'society_id')::uuid;
  END IF;

  SELECT COALESCE(jsonb_agg(ur.role), '[]'::jsonb) INTO _roles
  FROM user_roles ur WHERE ur.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(sp.*) ORDER BY sp.created_at), '[]'::jsonb) INTO _seller_profiles
  FROM seller_profiles sp WHERE sp.user_id = _user_id;

  SELECT COALESCE(jsonb_agg(bm.builder_id), '[]'::jsonb) INTO _builder_ids
  FROM builder_members bm WHERE bm.user_id = _user_id;

  RETURN jsonb_build_object(
    'profile', _profile,
    'society', _society,
    'roles', _roles,
    'seller_profiles', _seller_profiles,
    'society_admin_role', _society_admin,
    'builder_ids', _builder_ids
  );
END;
$function$;

-- Add statement_timeout to get_builder_dashboard
CREATE OR REPLACE FUNCTION public.get_builder_dashboard(_builder_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout = '5s'
AS $function$
DECLARE
  _result jsonb;
  _builder jsonb;
  _societies jsonb;
BEGIN
  SELECT to_jsonb(b.*) INTO _builder
  FROM builders b WHERE b.id = _builder_id;

  IF _builder IS NULL THEN
    RETURN jsonb_build_object('builder', null, 'societies', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'slug', s.slug,
      'city', s.city,
      'state', s.state,
      'is_active', s.is_active,
      'is_verified', s.is_verified,
      'is_under_construction', s.is_under_construction,
      'trust_score', s.trust_score,
      'member_count', s.member_count,
      'created_at', s.created_at,
      'pending_users', (
        SELECT COUNT(*) FROM profiles p
        WHERE p.society_id = s.id AND p.verification_status = 'pending'
      ),
      'total_members', (
        SELECT COUNT(*) FROM profiles p
        WHERE p.society_id = s.id AND p.verification_status = 'approved'
      ),
      'pending_sellers', (
        SELECT COUNT(*) FROM seller_profiles sp
        WHERE sp.society_id = s.id AND sp.verification_status = 'pending'
      ),
      'active_sellers', (
        SELECT COUNT(*) FROM seller_profiles sp
        WHERE sp.society_id = s.id AND sp.verification_status = 'approved'
      ),
      'open_disputes', (
        SELECT COUNT(*) FROM dispute_tickets dt
        WHERE dt.society_id = s.id AND dt.status NOT IN ('resolved', 'closed')
      ),
      'open_snags', (
        SELECT COUNT(*) FROM snag_tickets st
        WHERE st.society_id = s.id AND st.status NOT IN ('fixed', 'verified', 'closed')
      )
    ) ORDER BY s.name
  ), '[]'::jsonb) INTO _societies
  FROM societies s
  JOIN builder_societies bs ON bs.society_id = s.id
  WHERE bs.builder_id = _builder_id;

  RETURN jsonb_build_object(
    'builder', _builder,
    'societies', _societies
  );
END;
$function$;
