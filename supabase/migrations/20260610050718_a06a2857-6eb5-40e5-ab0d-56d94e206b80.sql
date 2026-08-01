-- Allow authenticated users to read resolved category requests so the
-- search picker can use them as dynamic aliases. Pending / rejected rows
-- remain restricted to the submitter + admins via the existing policy.
CREATE POLICY "Authenticated can read resolved requests"
ON public.category_requests
FOR SELECT
TO authenticated
USING (
  status IN ('approved', 'merged')
  AND COALESCE(created_category, merge_target_category) IS NOT NULL
);