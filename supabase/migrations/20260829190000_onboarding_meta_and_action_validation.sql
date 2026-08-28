-- Onboarding durable meta + store/product action_type consistency validation.

ALTER TABLE public.seller_profiles
  ADD COLUMN IF NOT EXISTS onboarding_meta jsonb;

COMMENT ON COLUMN public.seller_profiles.onboarding_meta IS
  'Durable onboarding progress: step, commerce_model, seed_product_name, etc.';

-- Safe one-time sync: only draft/pending products on non-approved stores.
UPDATE public.products p
SET action_type = sp.default_action_type,
    updated_at = now()
FROM public.seller_profiles sp
WHERE p.seller_id = sp.id
  AND p.approval_status IN ('draft', 'pending')
  AND sp.verification_status IN ('draft', 'pending', 'rejected')
  AND sp.default_action_type IS NOT NULL
  AND p.action_type IS DISTINCT FROM sp.default_action_type;

CREATE OR REPLACE FUNCTION public.validate_seller_service_products_ready(p_seller_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_store_action text;
  v_mismatch record;
  v_missing record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.seller_profiles sp
    WHERE sp.id = p_seller_id AND sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'seller not found';
  END IF;

  SELECT sp.default_action_type INTO v_store_action
  FROM public.seller_profiles sp
  WHERE sp.id = p_seller_id;

  -- Block when any draft/pending product action disagrees with store default.
  SELECT p.id, p.name, p.action_type
  INTO v_mismatch
  FROM public.products p
  WHERE p.seller_id = p_seller_id
    AND p.approval_status IN ('draft', 'pending')
    AND v_store_action IS NOT NULL
    AND p.action_type IS DISTINCT FROM v_store_action
  ORDER BY p.created_at
  LIMIT 1;

  IF v_mismatch.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'product_id', v_mismatch.id,
      'product_name', v_mismatch.name,
      'reason', format(
        'Product "%s" uses buyer interaction "%s" but your store is set to "%s". Open the product and save again, or change your store mode.',
        v_mismatch.name,
        v_mismatch.action_type,
        v_store_action
      )
    );
  END IF;

  -- All products inherit store action for service-listing requirements.
  SELECT p.id, p.name
  INTO v_missing
  FROM public.products p
  LEFT JOIN public.service_listings sl ON sl.product_id = p.id
  LEFT JOIN public.action_type_workflow_map atm ON atm.action_type = v_store_action
  WHERE p.seller_id = p_seller_id
    AND p.approval_status IN ('draft', 'pending')
    AND COALESCE(atm.requires_availability, false) = true
    AND sl.product_id IS NULL
  ORDER BY p.created_at
  LIMIT 1;

  IF v_missing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'product_id', v_missing.id,
      'product_name', v_missing.name,
      'reason', format('Service settings are missing for "%s". Open it, save again, then continue.', v_missing.name)
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_seller_service_products_ready(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_seller_service_products_ready(uuid) TO authenticated, service_role;
