
-- ============================================================
-- Fix #5: Add society_id scoping to commerce tables
-- ============================================================

-- 1. cart_items
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id);
CREATE INDEX IF NOT EXISTS idx_cart_items_society ON public.cart_items(society_id);

CREATE OR REPLACE FUNCTION public.set_cart_item_society_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.society_id IS NULL THEN
    SELECT society_id INTO NEW.society_id FROM profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_cart_item_society ON public.cart_items;
CREATE TRIGGER trg_set_cart_item_society BEFORE INSERT ON public.cart_items FOR EACH ROW EXECUTE FUNCTION public.set_cart_item_society_id();

UPDATE public.cart_items ci SET society_id = p.society_id FROM public.profiles p WHERE ci.user_id = p.id AND ci.society_id IS NULL;

-- 2. favorites
ALTER TABLE public.favorites ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id);
CREATE INDEX IF NOT EXISTS idx_favorites_society ON public.favorites(society_id);

CREATE OR REPLACE FUNCTION public.set_favorite_society_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.society_id IS NULL THEN
    SELECT society_id INTO NEW.society_id FROM profiles WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_favorite_society ON public.favorites;
CREATE TRIGGER trg_set_favorite_society BEFORE INSERT ON public.favorites FOR EACH ROW EXECUTE FUNCTION public.set_favorite_society_id();

UPDATE public.favorites f SET society_id = p.society_id FROM public.profiles p WHERE f.user_id = p.id AND f.society_id IS NULL;

-- 3. payment_records
ALTER TABLE public.payment_records ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id);
CREATE INDEX IF NOT EXISTS idx_payment_records_society ON public.payment_records(society_id);

CREATE OR REPLACE FUNCTION public.set_payment_record_society_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.society_id IS NULL THEN
    SELECT society_id INTO NEW.society_id FROM orders WHERE id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_payment_record_society ON public.payment_records;
CREATE TRIGGER trg_set_payment_record_society BEFORE INSERT ON public.payment_records FOR EACH ROW EXECUTE FUNCTION public.set_payment_record_society_id();

UPDATE public.payment_records pr SET society_id = o.society_id FROM public.orders o WHERE pr.order_id = o.id AND pr.society_id IS NULL;

-- 4. reviews (uses buyer_id, not user_id)
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS society_id uuid REFERENCES public.societies(id);
CREATE INDEX IF NOT EXISTS idx_reviews_society ON public.reviews(society_id);

CREATE OR REPLACE FUNCTION public.set_review_society_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.society_id IS NULL THEN
    SELECT society_id INTO NEW.society_id FROM profiles WHERE id = NEW.buyer_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_review_society ON public.reviews;
CREATE TRIGGER trg_set_review_society BEFORE INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.set_review_society_id();

UPDATE public.reviews r SET society_id = p.society_id FROM public.profiles p WHERE r.buyer_id = p.id AND r.society_id IS NULL;
