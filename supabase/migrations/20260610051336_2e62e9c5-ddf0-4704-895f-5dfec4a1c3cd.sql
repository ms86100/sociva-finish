-- 1. Add subcategory-request columns
ALTER TABLE public.category_requests
  ADD COLUMN IF NOT EXISTS request_kind TEXT NOT NULL DEFAULT 'category'
    CHECK (request_kind IN ('category', 'subcategory')),
  ADD COLUMN IF NOT EXISTS parent_category_config_id UUID
    REFERENCES public.category_config(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_subcategory_id UUID
    REFERENCES public.subcategories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merge_target_subcategory_id UUID
    REFERENCES public.subcategories(id) ON DELETE SET NULL;

-- 2. Ensure subcategory requests carry a parent reference
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'category_requests_subcat_parent_chk'
  ) THEN
    ALTER TABLE public.category_requests
      ADD CONSTRAINT category_requests_subcat_parent_chk
      CHECK (request_kind = 'category' OR parent_category_config_id IS NOT NULL);
  END IF;
END $$;

-- 3. Rebuild pending uniqueness to include kind + parent (a different parent
--    or kind is a different request)
DROP INDEX IF EXISTS public.category_requests_pending_unique;
CREATE UNIQUE INDEX category_requests_pending_unique
  ON public.category_requests (
    requested_by,
    normalized_name,
    request_kind,
    COALESCE(parent_category_config_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'pending';

-- 4. Widen the resolved-read policy so resolved subcategory requests are also
--    visible (used for dynamic alias suggestions in the seller search picker).
DROP POLICY IF EXISTS "Authenticated can read resolved requests" ON public.category_requests;
CREATE POLICY "Authenticated can read resolved requests"
ON public.category_requests
FOR SELECT
TO authenticated
USING (
  status IN ('approved', 'merged')
  AND (
    COALESCE(created_category, merge_target_category) IS NOT NULL
    OR COALESCE(created_subcategory_id, merge_target_subcategory_id) IS NOT NULL
  )
);

-- 5. Helpful index for "what subcategories were resolved under this parent"
CREATE INDEX IF NOT EXISTS category_requests_parent_kind_idx
  ON public.category_requests (parent_category_config_id, request_kind, status);