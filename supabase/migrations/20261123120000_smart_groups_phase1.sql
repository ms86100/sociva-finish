-- Smart Groups Phase 1: evolve bulletin into intelligent community posting.
-- Canonical storage remains bulletin_posts. No tables named "groups".

-- ---------------------------------------------------------------------------
-- 1. Feature flag
-- ---------------------------------------------------------------------------
INSERT INTO public.platform_features (
  feature_key,
  feature_name,
  display_name,
  description,
  tagline,
  category,
  is_core,
  society_configurable,
  route,
  icon_name,
  audience,
  capabilities
)
VALUES (
  'smart_groups',
  'Smart Groups',
  'Smart Groups',
  'Post once. Sociva routes your message to the right neighbours via intelligent community feeds.',
  'One post. The right people. The right answer.',
  'community',
  false,
  true,
  '/community',
  'Sparkles',
  ARRAY['Resident', 'Society Admin'],
  ARRAY[
    'Smart post composer with intent detection',
    'Find Help, Rent & Sell, Recommendations feeds',
    'HelpHub and marketplace deep links',
    'Restrained reply notifications'
  ]
)
ON CONFLICT (feature_key) DO UPDATE SET
  feature_name = EXCLUDED.feature_name,
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  tagline = EXCLUDED.tagline,
  route = EXCLUDED.route,
  icon_name = EXCLUDED.icon_name,
  society_configurable = EXCLUDED.society_configurable,
  is_active = true;

INSERT INTO public.feature_package_items (package_id, feature_id, enabled)
SELECT fp.id, pf.id, true
FROM public.feature_packages fp
CROSS JOIN public.platform_features pf
WHERE fp.is_default = true
  AND fp.is_active = true
  AND pf.feature_key = 'smart_groups'
  AND NOT EXISTS (
    SELECT 1 FROM public.feature_package_items x
    WHERE x.package_id = fp.id AND x.feature_id = pf.id
  );

-- ---------------------------------------------------------------------------
-- 2. bulletin_posts extensions
-- ---------------------------------------------------------------------------
ALTER TABLE public.bulletin_posts
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS service_category text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS structured jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_helphub_listing_id uuid,
  ADD COLUMN IF NOT EXISTS linked_product_id uuid,
  ADD COLUMN IF NOT EXISTS recommendation_count integer NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bulletin_posts_status_check'
  ) THEN
    ALTER TABLE public.bulletin_posts
      ADD CONSTRAINT bulletin_posts_status_check
      CHECK (status IN ('open', 'closed', 'expired'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'helphub_listings'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulletin_posts_linked_helphub_listing_id_fkey'
  ) THEN
    ALTER TABLE public.bulletin_posts
      ADD CONSTRAINT bulletin_posts_linked_helphub_listing_id_fkey
      FOREIGN KEY (linked_helphub_listing_id)
      REFERENCES public.helphub_listings(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bulletin_posts_linked_product_id_fkey'
  ) THEN
    ALTER TABLE public.bulletin_posts
      ADD CONSTRAINT bulletin_posts_linked_product_id_fkey
      FOREIGN KEY (linked_product_id)
      REFERENCES public.products(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bulletin_posts_society_category_created
  ON public.bulletin_posts (society_id, category, created_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_bulletin_posts_society_service_created
  ON public.bulletin_posts (society_id, service_category, created_at DESC)
  WHERE is_archived = false AND service_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bulletin_posts_society_status
  ON public.bulletin_posts (society_id, status)
  WHERE is_archived = false;

-- ---------------------------------------------------------------------------
-- 3. Multi-category map (canonical post, many feed memberships)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bulletin_post_categories (
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  category text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, category)
);

CREATE INDEX IF NOT EXISTS idx_bulletin_post_categories_category
  ON public.bulletin_post_categories (category);

ALTER TABLE public.bulletin_post_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Society members can view post categories" ON public.bulletin_post_categories;
CREATE POLICY "Society members can view post categories"
  ON public.bulletin_post_categories FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_post_categories.post_id
        AND (bp.society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Authors can insert post categories" ON public.bulletin_post_categories;
CREATE POLICY "Authors can insert post categories"
  ON public.bulletin_post_categories FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_post_categories.post_id
        AND bp.author_id = auth.uid()
        AND bp.society_id = public.get_user_society_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authors and admins can delete post categories" ON public.bulletin_post_categories;
CREATE POLICY "Authors and admins can delete post categories"
  ON public.bulletin_post_categories FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_post_categories.post_id
        AND (
          bp.author_id = auth.uid()
          OR public.is_admin(auth.uid())
          OR public.is_society_admin(auth.uid(), bp.society_id)
        )
    )
  );

DROP POLICY IF EXISTS "feature_gate_bulletin_post_categories_insert" ON public.bulletin_post_categories;
CREATE POLICY "feature_gate_bulletin_post_categories_insert"
  ON public.bulletin_post_categories AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_feature(public.get_user_society_id(auth.uid()), 'bulletin')
  );

DROP POLICY IF EXISTS "feature_gate_bulletin_post_categories_delete" ON public.bulletin_post_categories;
CREATE POLICY "feature_gate_bulletin_post_categories_delete"
  ON public.bulletin_post_categories AS RESTRICTIVE FOR DELETE TO authenticated
  USING (
    public.can_access_feature(public.get_user_society_id(auth.uid()), 'bulletin')
  );

-- ---------------------------------------------------------------------------
-- 4. Classification audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bulletin_post_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES public.bulletin_posts(id) ON DELETE CASCADE,
  intent text,
  suggested_categories text[] NOT NULL DEFAULT '{}',
  service_category text,
  confidence numeric(5,4),
  match_band text,
  user_corrected boolean NOT NULL DEFAULT false,
  raw_signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bulletin_post_classifications_match_band_check
    CHECK (match_band IS NULL OR match_band IN ('strong', 'reasonable', 'weak', 'none'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bulletin_post_classifications_post
  ON public.bulletin_post_classifications (post_id);

ALTER TABLE public.bulletin_post_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Society members can view classifications" ON public.bulletin_post_classifications;
CREATE POLICY "Society members can view classifications"
  ON public.bulletin_post_classifications FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_post_classifications.post_id
        AND (bp.society_id = public.get_user_society_id(auth.uid()) OR public.is_admin(auth.uid()))
    )
  );

DROP POLICY IF EXISTS "Authors can insert classifications" ON public.bulletin_post_classifications;
CREATE POLICY "Authors can insert classifications"
  ON public.bulletin_post_classifications FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bulletin_posts bp
      WHERE bp.id = bulletin_post_classifications.post_id
        AND bp.author_id = auth.uid()
        AND bp.society_id = public.get_user_society_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "feature_gate_bulletin_post_classifications_insert" ON public.bulletin_post_classifications;
CREATE POLICY "feature_gate_bulletin_post_classifications_insert"
  ON public.bulletin_post_classifications AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_feature(public.get_user_society_id(auth.uid()), 'bulletin')
  );

-- ---------------------------------------------------------------------------
-- 5. Recommendation flag on comments
-- ---------------------------------------------------------------------------
ALTER TABLE public.bulletin_comments
  ADD COLUMN IF NOT EXISTS is_recommendation boolean NOT NULL DEFAULT false;

-- Keep recommendation_count in sync
CREATE OR REPLACE FUNCTION public.update_bulletin_recommendation_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.is_recommendation THEN
    UPDATE public.bulletin_posts
    SET recommendation_count = recommendation_count + 1
    WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.is_recommendation THEN
    UPDATE public.bulletin_posts
    SET recommendation_count = GREATEST(recommendation_count - 1, 0)
    WHERE id = OLD.post_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_recommendation AND NOT OLD.is_recommendation THEN
      UPDATE public.bulletin_posts
      SET recommendation_count = recommendation_count + 1
      WHERE id = NEW.post_id;
    ELSIF OLD.is_recommendation AND NOT NEW.is_recommendation THEN
      UPDATE public.bulletin_posts
      SET recommendation_count = GREATEST(recommendation_count - 1, 0)
      WHERE id = NEW.post_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_update_bulletin_recommendation_count ON public.bulletin_comments;
CREATE TRIGGER trg_update_bulletin_recommendation_count
  AFTER INSERT OR UPDATE OR DELETE ON public.bulletin_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_bulletin_recommendation_count();

-- ---------------------------------------------------------------------------
-- 6. Soft daily post rate limit (20 / author / day)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_bulletin_daily_post_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.bulletin_posts
  WHERE author_id = NEW.author_id
    AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
        AT TIME ZONE 'Asia/Kolkata';

  IF v_count >= 20 THEN
    RAISE EXCEPTION 'Daily post limit reached. Try again tomorrow.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bulletin_daily_post_cap ON public.bulletin_posts;
CREATE TRIGGER trg_enforce_bulletin_daily_post_cap
  BEFORE INSERT ON public.bulletin_posts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bulletin_daily_post_cap();

-- ---------------------------------------------------------------------------
-- 7. Restrained reply notifications (author only, not society blast)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_bulletin_comment_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_id uuid;
  v_title text;
  v_is_rec boolean;
BEGIN
  SELECT bp.author_id, bp.title INTO v_author_id, v_title
  FROM public.bulletin_posts bp
  WHERE bp.id = NEW.post_id;

  IF v_author_id IS NULL OR v_author_id = NEW.author_id THEN
    RETURN NEW;
  END IF;

  v_is_rec := COALESCE(NEW.is_recommendation, false);

  INSERT INTO public.notification_queue (user_id, title, body, type, reference_path, action_url, payload)
  VALUES (
    v_author_id,
    CASE WHEN v_is_rec THEN 'New recommendation' ELSE 'New reply on your post' END,
    LEFT(
      CASE
        WHEN v_is_rec THEN 'Someone recommended help on: ' || COALESCE(v_title, 'your post')
        ELSE 'New reply on: ' || COALESCE(v_title, 'your post')
      END,
      180
    ),
    'community_reply',
    '/community',
    '/community',
    jsonb_build_object(
      'post_id', NEW.post_id,
      'comment_id', NEW.id,
      'is_recommendation', v_is_rec
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_bulletin_comment_reply ON public.bulletin_comments;
CREATE TRIGGER trg_notify_bulletin_comment_reply
  AFTER INSERT ON public.bulletin_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_bulletin_comment_reply();

-- ---------------------------------------------------------------------------
-- 8. Backfill primary category map for existing posts
-- ---------------------------------------------------------------------------
INSERT INTO public.bulletin_post_categories (post_id, category, is_primary)
SELECT id, category, true
FROM public.bulletin_posts
WHERE category IS NOT NULL
ON CONFLICT (post_id, category) DO NOTHING;
