
-- 1. Add estimated_resolution_hours to refund_requests
ALTER TABLE public.refund_requests 
ADD COLUMN IF NOT EXISTS estimated_resolution_hours integer NOT NULL DEFAULT 48;

-- 2. Add read_at timestamp to chat_messages
ALTER TABLE public.chat_messages 
ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- 3. Add last_active_at to seller_profiles
ALTER TABLE public.seller_profiles 
ADD COLUMN IF NOT EXISTS last_active_at timestamptz DEFAULT now();

-- 4. Trigger to update seller last_active_at on order status changes
CREATE OR REPLACE FUNCTION public.update_seller_last_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.seller_id IS NOT NULL THEN
    UPDATE public.seller_profiles
    SET last_active_at = now()
    WHERE id = NEW.seller_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_seller_last_active ON public.orders;
CREATE TRIGGER trg_update_seller_last_active
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.update_seller_last_active();
