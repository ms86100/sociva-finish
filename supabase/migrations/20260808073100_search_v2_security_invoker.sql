-- Public marketplace tables already enforce approved-listing RLS policies.
-- Run search under the caller's identity instead of bypassing those policies.
ALTER FUNCTION public.search_products_v2(
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  text[],
  numeric,
  boolean,
  numeric,
  numeric,
  text,
  integer,
  integer
) SECURITY INVOKER;
