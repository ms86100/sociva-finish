
-- Add email column to profiles table
ALTER TABLE public.profiles ADD COLUMN email text;

-- Backfill existing profiles with email from auth.users
UPDATE public.profiles 
SET email = u.email 
FROM auth.users u 
WHERE profiles.id = u.id;
