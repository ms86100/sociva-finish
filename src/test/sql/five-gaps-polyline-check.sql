CREATE OR REPLACE FUNCTION public.cleaner_city_haversine_meters(
  a double precision, b double precision, c double precision, d double precision
) RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(c - a) / 2), 2)
    + cos(radians(a)) * cos(radians(c)) * power(sin(radians(d - b) / 2), 2)
  ));
$$;

SELECT public.cleaner_city_polyline_overlap_pct(
  '_p~iF~ps|U_ulLnnqC_mqNvxq`@', 38.5, -120.2, 40.7, -120.95
) AS near_route;

SELECT public.cleaner_city_polyline_overlap_pct(
  '_p~iF~ps|U_ulLnnqC_mqNvxq`@', 0, 0, 1, 1
) AS far_route;
