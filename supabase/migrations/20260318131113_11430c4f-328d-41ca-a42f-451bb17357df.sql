
-- Gap B: RPC for buyer to confirm delivery (delivered -> completed)
CREATE OR REPLACE FUNCTION public.buyer_confirm_delivery(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.orders
  SET status = 'completed',
      updated_at = now()
  WHERE id = _order_id
    AND buyer_id = auth.uid()
    AND status = 'delivered';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found, not yours, or not in delivered status';
  END IF;
END;
$$;

-- Gap H: RPC for buyer to cancel order
CREATE OR REPLACE FUNCTION public.buyer_cancel_order(_order_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _current_status text;
BEGIN
  SELECT status INTO _current_status
  FROM public.orders
  WHERE id = _order_id AND buyer_id = auth.uid();

  IF _current_status IS NULL THEN
    RAISE EXCEPTION 'Order not found or not yours';
  END IF;

  IF _current_status NOT IN ('placed', 'accepted') THEN
    RAISE EXCEPTION 'This order cannot be cancelled at this stage';
  END IF;

  UPDATE public.orders
  SET status = 'cancelled',
      rejection_reason = _reason,
      updated_at = now()
  WHERE id = _order_id
    AND buyer_id = auth.uid();
END;
$$;

-- Gap C: Add needs_attention flag instead of aggressive auto-cancel
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS needs_attention boolean DEFAULT false;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS needs_attention_reason text;
