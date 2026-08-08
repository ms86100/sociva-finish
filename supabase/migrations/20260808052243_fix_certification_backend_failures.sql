-- Production certification repairs:
-- 1) Keep the internal PNQ debounce table out of exposed-schema RLS advisories.
-- 2) Preserve order activity audit writes by passing the UUID target_id as UUID.

ALTER TABLE public._pnq_wakeup_gate ENABLE ROW LEVEL SECURITY;

-- No client policy is intentional. Existing grants are revoked from
-- PUBLIC/anon/authenticated; postgres and service_role retain internal access.
REVOKE ALL ON TABLE public._pnq_wakeup_gate FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON TABLE public._pnq_wakeup_gate TO postgres, service_role;

CREATE OR REPLACE FUNCTION public.log_order_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      INSERT INTO public.audit_log (
        actor_id,
        action,
        target_type,
        target_id,
        society_id,
        metadata
      )
      VALUES (
        auth.uid(),
        'order_status_' || NEW.status,
        'order',
        NEW.id,
        NEW.society_id,
        jsonb_build_object(
          'from_status', OLD.status,
          'to_status', NEW.status,
          'order_type', NEW.order_type
        )
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.trigger_errors (
      trigger_name,
      table_name,
      error_message,
      error_detail
    )
    VALUES (
      'log_order_activity',
      'orders',
      SQLERRM,
      'order_id=' || NEW.id::text
    );
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.log_order_activity() IS
  'Best-effort order status audit. Keeps target_id as UUID and records unexpected trigger failures.';
