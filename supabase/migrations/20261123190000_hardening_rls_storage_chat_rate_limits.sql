-- Staging/production-safe hardening from production readiness audit.
-- 1) RLS on internal variant gate tables (deny API roles; service_role bypasses RLS)
-- 2) Storage MIME/size caps on buckets that lacked them
-- 3) Generous chat message rate limits (60 / 10 minutes per sender)

-- ── 1. Variant gate tables ──────────────────────────────────────────────────
ALTER TABLE IF EXISTS public._variant_gate_backup ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public._variant_gate_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage variant gate backup" ON public._variant_gate_backup;
CREATE POLICY "Admins manage variant gate backup"
  ON public._variant_gate_backup
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins manage variant gate scripts" ON public._variant_gate_scripts;
CREATE POLICY "Admins manage variant gate scripts"
  ON public._variant_gate_scripts
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- ── 2. Storage bucket limits ────────────────────────────────────────────────
UPDATE storage.buckets
SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
WHERE id IN ('banner-images', 'category-images', 'subcategory-images');

UPDATE storage.buckets
SET
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'
  ]
WHERE id IN ('payment-proofs', 'support-evidence', 'vehicle-documents');

-- ── 3. Chat rate limits (generous: 60 msgs / 10 min) ────────────────────────
CREATE OR REPLACE FUNCTION public.sociva_chat_message_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF NEW.sender_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'chat_messages' THEN
    SELECT count(*)::integer INTO v_count
    FROM public.chat_messages
    WHERE sender_id = NEW.sender_id
      AND created_at > now() - interval '10 minutes';
  ELSIF TG_TABLE_NAME = 'conversation_messages' THEN
    SELECT count(*)::integer INTO v_count
    FROM public.conversation_messages
    WHERE sender_id = NEW.sender_id
      AND created_at > now() - interval '10 minutes'
      AND deleted_at IS NULL;
  ELSE
    RETURN NEW;
  END IF;

  IF COALESCE(v_count, 0) >= 60 THEN
    RAISE EXCEPTION 'Too many messages. Please wait a few minutes before sending more.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sociva_chat_messages_rate_limit ON public.chat_messages;
CREATE TRIGGER sociva_chat_messages_rate_limit
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sociva_chat_message_rate_limit();

DROP TRIGGER IF EXISTS sociva_conversation_messages_rate_limit ON public.conversation_messages;
CREATE TRIGGER sociva_conversation_messages_rate_limit
  BEFORE INSERT ON public.conversation_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.sociva_chat_message_rate_limit();
