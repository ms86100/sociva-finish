-- Bug 1: Make coupons.society_id nullable for commercial sellers
ALTER TABLE public.coupons ALTER COLUMN society_id DROP NOT NULL;

-- Update unique constraint from (society_id, code) to (seller_id, code)
ALTER TABLE public.coupons DROP CONSTRAINT IF EXISTS coupons_society_id_code_key;
ALTER TABLE public.coupons ADD CONSTRAINT coupons_seller_id_code_key UNIQUE (seller_id, code);

-- Bug 3: Make seller_recommendations.society_id nullable
ALTER TABLE public.seller_recommendations ALTER COLUMN society_id DROP NOT NULL;

-- Bug 4: Make search_demand_log.society_id nullable
ALTER TABLE public.search_demand_log ALTER COLUMN society_id DROP NOT NULL;

-- Bug 8: Update log_order_activity to skip when society_id is null
CREATE OR REPLACE FUNCTION public.log_order_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.society_id IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    INSERT INTO public.society_activity (society_id, activity_type, actor_id, target_type, target_id, metadata)
    VALUES (NEW.society_id, CASE WHEN TG_OP='INSERT' THEN 'order_placed' ELSE 'order_updated' END, COALESCE(NEW.buyer_id, auth.uid()), 'order', NEW.id, jsonb_build_object('status', NEW.status));
  EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Activity log order %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

-- Update get_unmet_demand to handle nullable society_id
CREATE OR REPLACE FUNCTION public.get_unmet_demand(_society_id uuid)
 RETURNS TABLE(search_term text, search_count bigint, last_searched timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT sdl.search_term, COUNT(*)::bigint, MAX(sdl.searched_at)
  FROM public.search_demand_log sdl
  WHERE (_society_id IS NOT NULL AND sdl.society_id = _society_id)
     OR (_society_id IS NULL)
  GROUP BY sdl.search_term
  ORDER BY COUNT(*) DESC LIMIT 20;
END;
$function$;

-- Update RLS policy for search_demand_log sellers read
DROP POLICY IF EXISTS "Sellers can read unmet demand via RPC" ON public.search_demand_log;
CREATE POLICY "Sellers can read unmet demand via RPC" ON public.search_demand_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM seller_profiles sp
      WHERE sp.user_id = auth.uid()
        AND (
          (sp.society_id IS NOT NULL AND sp.society_id = search_demand_log.society_id)
          OR sp.seller_type = 'commercial'
          OR search_demand_log.society_id IS NULL
        )
    )
  );