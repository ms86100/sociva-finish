
ALTER FUNCTION public.compute_store_status(time without time zone, time without time zone, text, timestamp with time zone) SET search_path = public;
ALTER FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) SET search_path = public;
ALTER FUNCTION public.map_transaction_type_to_action_type(text) SET search_path = public;
ALTER FUNCTION public.products_search_vector_update() SET search_path = public;
ALTER FUNCTION public.resolve_transition_parent_group(text) SET search_path = public;
ALTER FUNCTION public.set_product_action_type_from_category() SET search_path = public;
ALTER FUNCTION public.validate_order_fulfillment_type() SET search_path = public;
ALTER FUNCTION public.validate_product_action_type() SET search_path = public;
ALTER FUNCTION public.validate_product_seller_category() SET search_path = public;
ALTER FUNCTION public.validate_product_store_action_type() SET search_path = public;
