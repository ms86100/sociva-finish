
CREATE OR REPLACE FUNCTION public.get_delivery_scores_batch(_seller_ids uuid[]) RETURNS TABLE(seller_id uuid, total_deliveries bigint, on_time_pct numeric, avg_delay_minutes numeric, completion_rate numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT o.seller_id,
    COUNT(da.id),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered' AND (da.eta_minutes IS NULL OR EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60 <= da.eta_minutes * 1.2)) * 100.0 / NULLIF(COUNT(*), 0), 1)
    END,
    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60) FILTER (WHERE da.delivered_at IS NOT NULL), 1), 0),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered') * 100.0 / NULLIF(COUNT(*), 0), 1)
    END
  FROM public.delivery_assignments da
  JOIN public.orders o ON o.id = da.order_id
  WHERE o.seller_id = ANY(_seller_ids)
  GROUP BY o.seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_price_stability(_product_id uuid) RETURNS TABLE(days_stable integer, price_change numeric, direction text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _last_change record;
BEGIN
  SELECT * INTO _last_change
  FROM public.price_history
  WHERE product_id = _product_id
  ORDER BY changed_at DESC LIMIT 1;

  IF _last_change IS NULL THEN
    RETURN QUERY SELECT
      EXTRACT(DAY FROM now() - (SELECT created_at FROM public.products WHERE id = _product_id))::integer,
      0::numeric,
      'stable'::text;
  ELSE
    RETURN QUERY SELECT
      EXTRACT(DAY FROM now() - _last_change.changed_at)::integer,
      ABS(_last_change.new_price - _last_change.old_price),
      CASE WHEN _last_change.new_price > _last_change.old_price THEN 'up'
           WHEN _last_change.new_price < _last_change.old_price THEN 'down'
           ELSE 'stable' END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_refund_tier(_amount numeric) RETURNS json
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
BEGIN
  IF _amount < 200 THEN
    RETURN json_build_object('tier', 'instant', 'label', 'Instant Refund', 'description', 'Processed immediately');
  ELSIF _amount <= 1000 THEN
    RETURN json_build_object('tier', '24h', 'label', '24h Review', 'description', 'Reviewed within 24 hours');
  ELSE
    RETURN json_build_object('tier', 'mediation', 'label', 'Dispute Mediation', 'description', 'Handled by community committee');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_delivery_score(_seller_id uuid) RETURNS TABLE(total_deliveries bigint, on_time_pct numeric, avg_delay_minutes numeric, completion_rate numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(da.id),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered' AND (da.eta_minutes IS NULL OR EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60 <= da.eta_minutes * 1.2)) * 100.0 / NULLIF(COUNT(*), 0), 1)
    END,
    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (da.delivered_at - da.assigned_at)) / 60) FILTER (WHERE da.delivered_at IS NOT NULL), 1), 0),
    CASE WHEN COUNT(da.id) = 0 THEN 0
      ELSE ROUND(COUNT(*) FILTER (WHERE da.status = 'delivered') * 100.0 / NULLIF(COUNT(*), 0), 1)
    END
  FROM public.delivery_assignments da
  JOIN public.orders o ON o.id = da.order_id
  WHERE o.seller_id = _seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_recommendations(_seller_id uuid) RETURNS TABLE(total_count bigint, recommenders json)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*),
    COALESCE(
      (SELECT json_agg(json_build_object('name', p.name, 'flat_number', p.flat_number, 'block', p.block))
       FROM (SELECT sr.recommender_id FROM public.seller_recommendations sr WHERE sr.seller_id = _seller_id ORDER BY sr.created_at DESC LIMIT 5) recent
       JOIN public.profiles p ON p.id = recent.recommender_id),
      '[]'::json
    )
  FROM public.seller_recommendations sr
  WHERE sr.seller_id = _seller_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_trust_tier(_seller_id uuid) RETURNS TABLE(tier_key text, tier_label text, badge_color text, icon_name text, growth_label text, growth_icon text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _orders integer;
  _rating numeric;
BEGIN
  SELECT COALESCE(sp.completed_order_count, 0), COALESCE(sp.rating, 0)
  INTO _orders, _rating
  FROM public.seller_profiles sp WHERE sp.id = _seller_id;

  RETURN QUERY
  SELECT t.tier_key, t.tier_label, t.badge_color, t.icon_name, t.growth_label, t.growth_icon
  FROM public.trust_tier_config t
  WHERE t.is_active = true
    AND _orders >= t.min_orders
    AND _rating >= t.min_rating
  ORDER BY t.display_order DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_society_search_suggestions(_society_id uuid, _limit integer DEFAULT 8) RETURNS TABLE(term text, count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT LOWER(TRIM(sdl.search_term)) AS term, COUNT(*) AS count
  FROM public.search_demand_log sdl
  WHERE sdl.society_id = _society_id
    AND sdl.created_at > now() - interval '14 days'
    AND LENGTH(TRIM(sdl.search_term)) >= 2
  GROUP BY LOWER(TRIM(sdl.search_term))
  HAVING COUNT(*) >= 2
  ORDER BY count DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_society_top_products(_society_id uuid, _limit integer DEFAULT 5) RETURNS TABLE(product_id uuid, product_name text, image_url text, order_count bigint, seller_name text, seller_id uuid, price numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT oi.product_id, p.name, p.image_url, COUNT(*)::bigint AS order_count,
    sp.business_name, p.seller_id, p.price
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.society_id = _society_id AND o.status NOT IN ('cancelled')
  GROUP BY oi.product_id, p.name, p.image_url, sp.business_name, p.seller_id, p.price
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_trending_products_by_society(_society_id uuid, _limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, description text, price numeric, image_url text, category text, is_veg boolean, is_available boolean, is_bestseller boolean, is_recommended boolean, is_urgent boolean, seller_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone, approval_status text, seller_business_name text, seller_rating numeric, seller_society_id uuid, seller_verification_status text, seller_fulfillment_mode text, seller_delivery_note text, seller_availability_start time without time zone, seller_availability_end time without time zone, seller_operating_days text[], seller_is_available boolean, seller_completed_order_count integer, seller_last_active_at timestamp with time zone, order_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.description, p.price, p.image_url,
    p.category::text, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status::text,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status::text, sp.fulfillment_mode::text,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at,
    COUNT(oi.id)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.society_id = _society_id
    AND o.status NOT IN ('cancelled')
    AND o.created_at > now() - interval '7 days'
    AND p.is_available = true
    AND p.approval_status = 'approved'
    AND sp.verification_status = 'approved'
  GROUP BY p.id, p.name, p.description, p.price, p.image_url,
    p.category, p.is_veg, p.is_available, p.is_bestseller,
    p.is_recommended, p.is_urgent, p.seller_id, p.created_at, p.updated_at,
    p.approval_status,
    sp.business_name, sp.rating, sp.society_id,
    sp.verification_status, sp.fulfillment_mode,
    sp.delivery_note, sp.availability_start, sp.availability_end,
    sp.operating_days, sp.is_available,
    sp.completed_order_count, sp.last_active_at
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_frequent_products(_user_id uuid, _limit integer DEFAULT 12) RETURNS TABLE(product_id uuid, product_name text, price numeric, image_url text, seller_id uuid, seller_name text, order_count bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.name, p.price, p.image_url, p.seller_id,
    sp.business_name, COUNT(*)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  JOIN public.products p ON p.id = oi.product_id
  LEFT JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE o.buyer_id = _user_id AND o.status = 'completed' AND p.is_available = true
  GROUP BY p.id, p.name, p.price, p.image_url, p.seller_id, sp.business_name
  ORDER BY order_count DESC
  LIMIT _limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.hold_service_slot(_slot_id uuid, _user_id uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.slot_holds WHERE expires_at < now();

  IF EXISTS (SELECT 1 FROM public.slot_holds WHERE slot_id = _slot_id AND user_id = _user_id AND expires_at > now()) THEN
    RETURN json_build_object('success', true, 'message', 'Already holding this slot');
  END IF;

  INSERT INTO public.slot_holds (slot_id, user_id, expires_at)
  VALUES (_slot_id, _user_id, now() + interval '5 minutes');

  RETURN json_build_object('success', true, 'message', 'Slot held for 5 minutes');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.log_bulletin_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, entity_type, entity_id, metadata)
    VALUES (NEW.society_id, 'bulletin_post', NEW.author_id, 'bulletin_post', NEW.id,
      jsonb_build_object('title', NEW.title, 'type', NEW.type));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_help_request_activity() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, entity_type, entity_id, metadata)
    VALUES (NEW.society_id, 'help_request', NEW.requester_id, 'help_request', NEW.id,
      jsonb_build_object('title', NEW.title, 'category', NEW.category));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_favorited_seller_new_product() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.notification_queue (user_id, title, body, type, data)
  SELECT
    f.user_id,
    'New from ' || sp.business_name,
    NEW.name || ' just added!',
    'new_product',
    jsonb_build_object('product_id', NEW.id, 'seller_id', NEW.seller_id)
  FROM public.favorites f
  JOIN public.seller_profiles sp ON sp.id = f.seller_id
  WHERE f.seller_id = NEW.seller_id
    AND f.user_id != sp.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_banner_products(p_mode text, p_value text, p_society_id uuid, p_buyer_lat double precision DEFAULT NULL::double precision, p_buyer_lng double precision DEFAULT NULL::double precision, p_limit integer DEFAULT 20) RETURNS TABLE(id uuid, name text, price numeric, mrp numeric, image_url text, category text, is_veg boolean, is_available boolean, is_bestseller boolean, stock_quantity integer, low_stock_threshold integer, seller_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _society_lat double precision;
  _society_lng double precision;
BEGIN
  IF p_society_id IS NOT NULL THEN
    SELECT s.latitude, s.longitude
    INTO _society_lat, _society_lng
    FROM public.societies s
    WHERE s.id = p_society_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.price, p.mrp, p.image_url,
    p.category::text, p.is_veg, p.is_available, p.is_bestseller,
    p.stock_quantity, p.low_stock_threshold, p.seller_id
  FROM public.products p
  JOIN public.seller_profiles sp ON sp.id = p.seller_id
  WHERE
    p.is_available = true
    AND p.approval_status = 'approved'
    AND p.stock_quantity > 0
    AND sp.is_available = true
    AND sp.verification_status = 'approved'
    AND (
      p_society_id IS NULL
      OR sp.society_id = p_society_id
      OR (
        sp.society_id IS DISTINCT FROM p_society_id
        AND (sp.society_id IS NULL OR sp.sell_beyond_community = true)
        AND sp.latitude IS NOT NULL AND _society_lat IS NOT NULL
        AND public.haversine_km(sp.latitude, sp.longitude, _society_lat, _society_lng)
            <= COALESCE(sp.delivery_radius_km, 0)
      )
    )
    AND (
      p_buyer_lat IS NULL OR p_buyer_lng IS NULL
      OR sp.latitude IS NULL OR sp.longitude IS NULL
      OR public.haversine_km(sp.latitude, sp.longitude, p_buyer_lat, p_buyer_lng)
          <= COALESCE(sp.delivery_radius_km, 0)
    )
    AND (
      CASE p_mode
        WHEN 'category' THEN p.category::text = p_value
        WHEN 'search' THEN p.search_vector @@ plainto_tsquery('english', COALESCE(p_value, ''))
        WHEN 'popular' THEN p.is_bestseller = true
        ELSE true
      END
    )
  ORDER BY
    (p.stock_quantity > 0)::int DESC,
    p.is_bestseller DESC,
    p.is_recommended DESC,
    p.price ASC
  LIMIT p_limit;
END;
$$;
