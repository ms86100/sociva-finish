-- WhatsApp Cloud API message log + credential keys for admin_settings

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  phone text NOT NULL,
  message text,
  meta_message_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received', 'unknown')),
  error_code text,
  error_message text,
  template_name text,
  meta_payload jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_created_idx
  ON public.whatsapp_messages (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_messages_meta_id_idx
  ON public.whatsapp_messages (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_created_at_idx
  ON public.whatsapp_messages (created_at DESC);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Admins can read all WhatsApp logs
DROP POLICY IF EXISTS whatsapp_messages_admin_select ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_admin_select
  ON public.whatsapp_messages
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- No direct client inserts/updates — edge functions use service role
DROP POLICY IF EXISTS whatsapp_messages_admin_insert ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_admin_insert
  ON public.whatsapp_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.whatsapp_messages IS
  'Outbound/inbound WhatsApp Cloud API messages for Sociva notification service';

-- Seed credential keys (values set via Admin Credentials or supabase secrets)
INSERT INTO public.admin_settings (key, value, is_active, description)
VALUES
  ('whatsapp_access_token', NULL, true, 'Meta WhatsApp Cloud API permanent access token'),
  ('whatsapp_phone_number_id', NULL, true, 'Meta WhatsApp Phone Number ID'),
  ('whatsapp_verify_token', NULL, true, 'Webhook verify token for Meta GET challenge'),
  ('whatsapp_business_account_id', NULL, true, 'Optional Meta WhatsApp Business Account ID')
ON CONFLICT (key) DO NOTHING;
