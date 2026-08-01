
-- Grant service_role full access to banner_section_products
GRANT ALL ON public.banner_section_products TO service_role;
GRANT ALL ON public.coupons TO service_role;

-- Seed banner section products (Diwali Celebrations)
INSERT INTO public.banner_section_products (section_id, product_id, display_order) VALUES
  -- Sweets & Mithai
  ('d2000000-0000-0000-0000-000000000001', '88fd2de0-6a32-4861-b51f-77ac4b1fb398', 1),
  ('d2000000-0000-0000-0000-000000000001', 'dba42783-6bcf-4888-92f9-9030dc572395', 2),
  ('d2000000-0000-0000-0000-000000000001', '886025e4-9022-4743-b449-bacd593525ce', 3),
  ('d2000000-0000-0000-0000-000000000001', '6c225e15-7fab-4672-8afc-9faaf05bdfa8', 4),
  ('d2000000-0000-0000-0000-000000000001', 'e446d25a-1375-4e90-b4ef-9d5eb3122891', 5),
  -- Festive Fashion
  ('d2000000-0000-0000-0000-000000000002', '386b07fe-379f-4bc7-a90d-fe55d85bceed', 1),
  ('d2000000-0000-0000-0000-000000000002', '4ed4d6a8-fd4d-417b-a7b2-3fbc437927fe', 2),
  ('d2000000-0000-0000-0000-000000000002', 'ef34749a-1b32-4daf-bd83-010b0b80459d', 3),
  ('d2000000-0000-0000-0000-000000000002', 'd0d2011a-8214-495a-97d1-b824eaa8a6b7', 4),
  ('d2000000-0000-0000-0000-000000000002', '6b153a82-ad36-42b4-b103-4d1651c5d8ac', 5),
  -- Mehendi & Beauty
  ('d2000000-0000-0000-0000-000000000003', '21f5e2ec-a4b3-4f3d-b68f-ec6d7029b6b6', 1),
  ('d2000000-0000-0000-0000-000000000003', '91fee132-6b0c-4e45-aeb8-125d8c9c4e13', 2),
  ('d2000000-0000-0000-0000-000000000003', 'c2ec1b2a-bcd6-418b-8985-b7857cd3fb1e', 3),
  ('d2000000-0000-0000-0000-000000000003', '1a60493d-9656-46be-8466-848e7312ede4', 4),
  ('d2000000-0000-0000-0000-000000000003', 'bc7b780e-e2d4-4b96-ae35-53f395629106', 5),
  -- Home Services
  ('d2000000-0000-0000-0000-000000000004', 'd734b565-54dd-49e0-a56a-58cd91488538', 1),
  ('d2000000-0000-0000-0000-000000000004', '0a1bd8bd-0fc6-4ffd-af20-8c17eca5ebb9', 2),
  ('d2000000-0000-0000-0000-000000000004', 'a5eea9e0-6c34-4428-90f1-e2851c77392e', 3),
  ('d2000000-0000-0000-0000-000000000004', '3a0e2fc9-c2a5-4dc8-956d-558bb3514a61', 4),
  ('d2000000-0000-0000-0000-000000000004', '181e0004-b5f8-4d9a-b85e-8c47521ecd9d', 5)
ON CONFLICT DO NOTHING;

-- Add unique constraint on coupons.code if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coupons_code_key') THEN
    ALTER TABLE public.coupons ADD CONSTRAINT coupons_code_key UNIQUE (code);
  END IF;
END $$;

-- Seed additional coupons
INSERT INTO public.coupons (code, discount_type, discount_value, seller_id, is_active, show_to_buyers, per_user_limit, description, society_id)
VALUES
  ('AYUR25', 'percentage', 25, 'b9914568-df7b-4223-aeea-9828a078039e', true, true, 2, '25% off all Ayurveda services', 'a0000000-0000-0000-0000-000000000001'),
  ('FIXHOME', 'flat', 50, 'c1000000-0000-0000-0000-000000000002', true, true, 1, '₹50 off home services', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT (code) DO NOTHING;
