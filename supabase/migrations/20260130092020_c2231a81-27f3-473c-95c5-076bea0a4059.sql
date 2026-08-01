-- Drop existing FKs pointing to auth.users and recreate to point to profiles

-- seller_profiles: drop FK to auth.users, add FK to profiles
ALTER TABLE public.seller_profiles 
DROP CONSTRAINT IF EXISTS seller_profiles_user_id_fkey;

ALTER TABLE public.seller_profiles 
ADD CONSTRAINT seller_profiles_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- orders: drop FK to auth.users, add FK to profiles  
ALTER TABLE public.orders 
DROP CONSTRAINT IF EXISTS orders_buyer_id_fkey;

ALTER TABLE public.orders 
ADD CONSTRAINT orders_buyer_id_fkey 
FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- reviews: drop FK to auth.users, add FK to profiles
ALTER TABLE public.reviews 
DROP CONSTRAINT IF EXISTS reviews_buyer_id_fkey;

ALTER TABLE public.reviews 
ADD CONSTRAINT reviews_buyer_id_fkey 
FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;