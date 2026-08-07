-- ============================================================
-- P0: Wire live create_settlement_on_delivery() → _impl
-- Live DB still used a legacy body (status col, 5% hardcode,
-- delivered-only, no payment gate). Seller ledger + process-settlements
-- read seller_settlements.settlement_status from _impl.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Fire on delivered OR completed (self-pickup / terminal success)
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('delivered', 'completed') THEN
    PERFORM public.create_settlement_on_delivery_impl(OLD, NEW);
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.create_settlement_on_delivery() IS
  'Thin trigger wrapper — delegates to create_settlement_on_delivery_impl (paid/COD gate + seller_settlements).';

-- Ensure trigger exists on orders (idempotent)
DROP TRIGGER IF EXISTS trg_create_settlement_on_delivery ON public.orders;
CREATE TRIGGER trg_create_settlement_on_delivery
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.create_settlement_on_delivery();
