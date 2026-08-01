
-- Fix all presets where colors->'gradient' is a string instead of an array
-- Extract hex colors from the "linear-gradient(135deg,#XXX,#YYY,...)" string and convert to array
UPDATE public.banner_theme_presets
SET colors = jsonb_set(
  colors,
  '{gradient}',
  (
    SELECT jsonb_agg(m[1])
    FROM regexp_matches(colors->>'gradient', '#[0-9A-Fa-f]{3,6}', 'g') AS m
  )
)
WHERE jsonb_typeof(colors->'gradient') = 'string';
