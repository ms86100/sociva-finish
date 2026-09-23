-- Home discovery was hard-capped at 12 products per seller, so a 60-item
-- menu only showed the first 12. 60 covers the largest live catalogue
-- without letting one store return an unbounded list.

CREATE OR REPLACE FUNCTION public.get_products_for_sellers(
  _seller_ids uuid[],
  _category text DEFAULT NULL::text,
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0,
  _lat double precision DEFAULT NULL::double precision,
  _lng double precision DEFAULT NULL::double precision
)
RETURNS TABLE(
  product_id uuid,
  seller_id uuid,
  product_name text,
  price numeric,
  image_url text,
  category text,
  is_veg boolean,
  is_available boolean,
  is_bestseller boolean,
  is_recommended boolean,
  is_urgent boolean,
  action_type text,
  contact_phone text,
  mrp numeric,
  discount_percentage numeric,
  description text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_per_seller integer := 60;
BEGIN
  RETURN QUERY
  SELECT x.product_id, x.seller_id, x.product_name, x.price, x.image_url, x.category,
         x.is_veg, x.is_available, x.is_bestseller, x.is_recommended, x.is_urgent,
         x.action_type, x.contact_phone, x.mrp, x.discount_percentage, x.description
  FROM (
    SELECT
      p.id AS product_id,
      p.seller_id,
      p.name AS product_name,
      p.price,
      p.image_url,
      p.category::text AS category,
      p.is_veg,
      p.is_available,
      p.is_bestseller,
      p.is_recommended,
      p.is_urgent,
      p.action_type,
      p.contact_phone,
      p.mrp,
      p.discount_percentage,
      p.description,
      ROW_NUMBER() OVER (
        ORDER BY p.is_bestseller DESC NULLS LAST,
                 p.is_recommended DESC NULLS LAST,
                 p.name
      ) AS global_rn
    FROM unnest(_seller_ids) AS sid(id)
    CROSS JOIN LATERAL (
      SELECT p2.*
      FROM public.products p2
      WHERE p2.seller_id = sid.id
        AND p2.is_available = true
        AND p2.approval_status = 'approved'
        AND (_category IS NULL OR p2.category::text = _category)
        AND public.seller_is_discoverable_to_buyer(p2.seller_id, _lat, _lng)
      ORDER BY p2.is_bestseller DESC NULLS LAST,
               p2.is_recommended DESC NULLS LAST,
               p2.name
      LIMIT v_per_seller
    ) p
  ) x
  WHERE x.global_rn > COALESCE(_offset, 0)
  ORDER BY x.global_rn
  LIMIT GREATEST(
    COALESCE(_limit, 20),
    v_per_seller * GREATEST(COALESCE(array_length(_seller_ids, 1), 0), 1)
  );
END;
$function$;
