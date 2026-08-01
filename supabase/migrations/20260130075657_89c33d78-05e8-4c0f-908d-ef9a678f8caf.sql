-- Enums for the marketplace
CREATE TYPE public.user_role AS ENUM ('buyer', 'seller', 'admin');
CREATE TYPE public.verification_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE public.order_status AS ENUM ('placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled');
CREATE TYPE public.product_category AS ENUM ('home_food', 'bakery', 'snacks', 'groceries', 'other');

-- User profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  flat_number TEXT NOT NULL,
  block TEXT NOT NULL,
  avatar_url TEXT,
  verification_status verification_status DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User roles table (separate for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role user_role NOT NULL DEFAULT 'buyer',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role)
);

-- Seller profiles
CREATE TABLE public.seller_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  business_name TEXT NOT NULL,
  description TEXT,
  categories product_category[] NOT NULL DEFAULT '{}',
  cover_image_url TEXT,
  is_available BOOLEAN DEFAULT true,
  availability_start TIME,
  availability_end TIME,
  accepts_cod BOOLEAN DEFAULT true,
  verification_status verification_status DEFAULT 'pending',
  rating DECIMAL(2,1) DEFAULT 0,
  total_reviews INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products/Menu items
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID REFERENCES public.seller_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  category product_category NOT NULL,
  is_veg BOOLEAN DEFAULT true,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Orders
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_id UUID REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  status order_status DEFAULT 'placed',
  total_amount DECIMAL(10,2) NOT NULL,
  payment_type TEXT DEFAULT 'cod',
  delivery_address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Order items
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reviews
CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL UNIQUE,
  buyer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  seller_id UUID REFERENCES public.seller_profiles(id) ON DELETE CASCADE NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cart items (for session persistence)
CREATE TABLE public.cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role user_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
$$;

-- Profiles policies
CREATE POLICY "Users can view all approved profiles"
ON public.profiles FOR SELECT
USING (verification_status = 'approved' OR id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (id = auth.uid() OR public.is_admin(auth.uid()));

-- User roles policies
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Only admins can manage roles"
ON public.user_roles FOR ALL
USING (public.is_admin(auth.uid()));

CREATE POLICY "Users can insert default buyer role"
ON public.user_roles FOR INSERT
WITH CHECK (user_id = auth.uid() AND role = 'buyer');

-- Seller profiles policies
CREATE POLICY "Anyone can view approved sellers"
ON public.seller_profiles FOR SELECT
USING (verification_status = 'approved' OR user_id = auth.uid() OR public.is_admin(auth.uid()));

CREATE POLICY "Authenticated users can apply to be sellers"
ON public.seller_profiles FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Sellers can update their own profile"
ON public.seller_profiles FOR UPDATE
USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- Products policies
CREATE POLICY "Anyone can view available products from approved sellers"
ON public.products FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND verification_status = 'approved'
  ) OR 
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR
  public.is_admin(auth.uid())
);

CREATE POLICY "Sellers can manage their own products"
ON public.products FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  )
);

CREATE POLICY "Sellers can update their own products"
ON public.products FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR public.is_admin(auth.uid())
);

CREATE POLICY "Sellers can delete their own products"
ON public.products FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR public.is_admin(auth.uid())
);

-- Orders policies
CREATE POLICY "Users can view their own orders"
ON public.orders FOR SELECT
USING (
  buyer_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR
  public.is_admin(auth.uid())
);

CREATE POLICY "Authenticated users can create orders"
ON public.orders FOR INSERT
WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "Buyers and sellers can update orders"
ON public.orders FOR UPDATE
USING (
  buyer_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR
  public.is_admin(auth.uid())
);

-- Order items policies
CREATE POLICY "Users can view order items for their orders"
ON public.order_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.orders 
    WHERE id = order_id AND (
      buyer_id = auth.uid() OR 
      EXISTS (
        SELECT 1 FROM public.seller_profiles 
        WHERE id = orders.seller_id AND user_id = auth.uid()
      )
    )
  ) OR public.is_admin(auth.uid())
);

CREATE POLICY "Users can insert order items for their orders"
ON public.order_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.orders 
    WHERE id = order_id AND buyer_id = auth.uid()
  )
);

-- Reviews policies
CREATE POLICY "Anyone can view reviews"
ON public.reviews FOR SELECT
USING (true);

CREATE POLICY "Buyers can create reviews for completed orders"
ON public.reviews FOR INSERT
WITH CHECK (
  buyer_id = auth.uid() AND
  EXISTS (
    SELECT 1 FROM public.orders 
    WHERE id = order_id AND buyer_id = auth.uid() AND status = 'completed'
  )
);

-- Cart items policies
CREATE POLICY "Users can view their own cart"
ON public.cart_items FOR SELECT
USING (user_id = auth.uid());

CREATE POLICY "Users can manage their own cart"
ON public.cart_items FOR INSERT
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own cart"
ON public.cart_items FOR UPDATE
USING (user_id = auth.uid());

CREATE POLICY "Users can delete from their own cart"
ON public.cart_items FOR DELETE
USING (user_id = auth.uid());

-- Function to update seller rating
CREATE OR REPLACE FUNCTION public.update_seller_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.seller_profiles
  SET 
    rating = (SELECT COALESCE(AVG(rating), 0) FROM public.reviews WHERE seller_id = NEW.seller_id),
    total_reviews = (SELECT COUNT(*) FROM public.reviews WHERE seller_id = NEW.seller_id)
  WHERE id = NEW.seller_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER update_rating_on_review
AFTER INSERT OR UPDATE ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_seller_rating();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_seller_profiles_updated_at BEFORE UPDATE ON public.seller_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();