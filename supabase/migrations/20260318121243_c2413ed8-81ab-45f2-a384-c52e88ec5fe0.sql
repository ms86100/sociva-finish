
-- Make society_id nullable on delivery_assignments for marketplace orders without a society
ALTER TABLE public.delivery_assignments ALTER COLUMN society_id DROP NOT NULL;
