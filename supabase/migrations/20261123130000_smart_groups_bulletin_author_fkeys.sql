-- Restore author FKs required by PostgREST embeds used by Bulletin/Smart Groups UI.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bulletin_posts_author_id_fkey') THEN
    ALTER TABLE public.bulletin_posts
      ADD CONSTRAINT bulletin_posts_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bulletin_comments_author_id_fkey') THEN
    ALTER TABLE public.bulletin_comments
      ADD CONSTRAINT bulletin_comments_author_id_fkey
      FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
