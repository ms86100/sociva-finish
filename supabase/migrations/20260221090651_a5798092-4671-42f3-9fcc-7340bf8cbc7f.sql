CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique 
  ON public.profiles (phone) WHERE phone IS NOT NULL AND phone != '';