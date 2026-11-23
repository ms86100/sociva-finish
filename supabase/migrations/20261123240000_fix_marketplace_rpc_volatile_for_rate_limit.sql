-- PostgREST runs STABLE RPCs in read-only transactions.
-- Wrappers that call sociva_assert_rate_limit (FOR UPDATE / INSERT) must be VOLATILE,
-- otherwise Home / Book / Contact fail with "Couldn't load the marketplace"
-- (ERROR 25006: cannot execute SELECT FOR UPDATE in a read-only transaction).

ALTER FUNCTION public.search_sellers_paginated(double precision, double precision, double precision, integer, integer) VOLATILE;
ALTER FUNCTION public.search_products_v2(text, double precision, double precision, double precision, uuid, text[], numeric, boolean, numeric, numeric, text, integer, integer) VOLATILE;
ALTER FUNCTION public.get_products_for_sellers(uuid[], text, integer, integer, double precision, double precision) VOLATILE;
ALTER FUNCTION public.search_products_fts(text, double precision, double precision, double precision, text, integer, integer) VOLATILE;
ALTER FUNCTION public.get_society_search_suggestions(uuid, integer) VOLATILE;
