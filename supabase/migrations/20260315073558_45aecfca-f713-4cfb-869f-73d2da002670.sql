
-- 1. Add payment_screenshot_url column to orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_screenshot_url TEXT;

-- 2. Create payment-proofs storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('payment-proofs', 'payment-proofs', false)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS: Authenticated users can upload to their own folder
CREATE POLICY "Users can upload payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 4. RLS: Users can read their own uploads
CREATE POLICY "Users can read own payment proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- 5. RLS: Sellers can read payment proofs for their orders
CREATE POLICY "Sellers can read payment proofs for their orders"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.seller_profiles sp ON sp.id = o.seller_id
    WHERE sp.user_id = auth.uid()
      AND o.payment_screenshot_url LIKE '%' || storage.filename(name) || '%'
  )
);

-- 6. Update confirm_upi_payment RPC to accept optional screenshot and optional UTR
CREATE OR REPLACE FUNCTION public.confirm_upi_payment(
  _order_id uuid,
  _upi_transaction_ref text DEFAULT '',
  _payment_screenshot_url text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _order record;
  _trimmed_ref text;
BEGIN
  _trimmed_ref := COALESCE(trim(_upi_transaction_ref), '');

  -- Fetch order and verify ownership
  SELECT id, buyer_id, status, payment_status
  INTO _order
  FROM public.orders
  WHERE id = _order_id
  FOR UPDATE;

  IF _order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF _order.buyer_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _order.status NOT IN ('placed', 'accepted') THEN
    RAISE EXCEPTION 'Order is not in a payable state';
  END IF;

  IF _order.payment_status NOT IN ('pending') THEN
    RAISE EXCEPTION 'Payment already processed';
  END IF;

  -- Update order with whatever evidence was provided
  UPDATE public.orders
  SET upi_transaction_ref = CASE WHEN _trimmed_ref = '' THEN upi_transaction_ref ELSE _trimmed_ref END,
      payment_screenshot_url = COALESCE(_payment_screenshot_url, payment_screenshot_url),
      payment_status = 'buyer_confirmed',
      updated_at = now()
  WHERE id = _order_id;
END;
$function$;
