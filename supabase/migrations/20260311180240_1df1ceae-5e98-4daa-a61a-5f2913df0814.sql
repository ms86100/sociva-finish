ALTER TABLE public.subcategories
  ADD COLUMN supports_addons boolean DEFAULT NULL,
  ADD COLUMN supports_recurring boolean DEFAULT NULL,
  ADD COLUMN supports_staff_assignment boolean DEFAULT NULL;