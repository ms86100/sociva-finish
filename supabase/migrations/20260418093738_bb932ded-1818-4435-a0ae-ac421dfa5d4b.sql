ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.seller_conversation_messages REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'seller_conversation_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_conversation_messages';
  END IF;
END $$;