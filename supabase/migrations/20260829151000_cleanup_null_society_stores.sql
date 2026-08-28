-- One-time cleanup: approved stores with society_id = NULL (Aug 2026 E2E/testing).
-- 1) Backfill from profiles.society_id where possible
-- 2) Assign Integration Test Society to known E2E phone accounts
-- 3) Pause any remaining approved stores without society until seller links one

-- Step 1: seller_profiles ← profiles
UPDATE public.seller_profiles sp
SET society_id = p.society_id
FROM public.profiles p
WHERE sp.user_id = p.id
  AND sp.society_id IS NULL
  AND p.society_id IS NOT NULL;

-- Step 2: E2E / test phones → Integration Test Society (profile + all their stores)
WITH test_society AS (
  SELECT id FROM public.societies WHERE name = 'Integration Test Society' LIMIT 1
),
test_users AS (
  SELECT id FROM public.profiles
  WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') IN (
    '919535115316', '9535115316',
    '918448802907', '8448802907',
    '917976583647', '7976583647'
  )
)
UPDATE public.profiles p
SET society_id = (SELECT id FROM test_society)
WHERE p.id IN (SELECT id FROM test_users)
  AND p.society_id IS NULL
  AND EXISTS (SELECT 1 FROM test_society);

UPDATE public.seller_profiles sp
SET society_id = p.society_id
FROM public.profiles p
WHERE sp.user_id = p.id
  AND sp.society_id IS NULL
  AND p.society_id IS NOT NULL;

-- Step 3: cannot approve live without society — pause stragglers
UPDATE public.seller_profiles
SET
  verification_status = 'pending',
  is_available = false,
  rejection_note = 'Store paused (data fix): link your Sociva account to a society in Profile settings, then contact admin to re-approve.'
WHERE verification_status = 'approved'
  AND society_id IS NULL;
