ALTER TABLE profiles ALTER COLUMN search_radius_km SET DEFAULT 10;
UPDATE profiles SET search_radius_km = 10 WHERE search_radius_km = 5;