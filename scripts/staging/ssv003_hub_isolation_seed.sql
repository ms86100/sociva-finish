-- Staging-only hub isolation fixtures (ssvqa- prefix).
-- Do not run on production. Applied on staging via SQL editor / this script,
-- not via a production-bound migration.

INSERT INTO public.parking_slots (society_id, slot_number, slot_type, is_assigned, is_visitor_slot)
SELECT '94a7124c-a692-4d66-981f-0227b1317199', 'ssvqa-lv-p1', 'car', false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.parking_slots WHERE slot_number = 'ssvqa-lv-p1'
);

INSERT INTO public.parking_slots (society_id, slot_number, slot_type, is_assigned, is_visitor_slot)
SELECT '327fb699-542e-4ab6-b0b1-97022604bb88', 'ssvqa-gf-p1', 'car', false, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.parking_slots WHERE slot_number = 'ssvqa-gf-p1'
);

INSERT INTO public.parcel_entries (society_id, resident_id, flat_number, courier_name, tracking_number, description, status)
SELECT '94a7124c-a692-4d66-981f-0227b1317199', '6e6cebbb-9e31-45aa-a0e3-7ff551f1c58d', 'QA', 'SSVQA Courier', 'ssvqa-lv-trk', 'Lakeview isolation parcel', 'received'
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcel_entries WHERE tracking_number = 'ssvqa-lv-trk'
);

INSERT INTO public.parcel_entries (society_id, resident_id, flat_number, courier_name, tracking_number, description, status)
SELECT '327fb699-542e-4ab6-b0b1-97022604bb88', 'f28747e8-5d4f-4363-9387-081098c2754d', 'QA', 'SSVQA Courier', 'ssvqa-gf-trk', 'Greenfield isolation parcel', 'received'
WHERE NOT EXISTS (
  SELECT 1 FROM public.parcel_entries WHERE tracking_number = 'ssvqa-gf-trk'
);

INSERT INTO public.visitor_entries (society_id, resident_id, visitor_name, visitor_type, purpose, status)
SELECT '94a7124c-a692-4d66-981f-0227b1317199', '6e6cebbb-9e31-45aa-a0e3-7ff551f1c58d', 'SSVQA Lakeview Guest', 'guest', 'isolation seed', 'expected'
WHERE NOT EXISTS (
  SELECT 1 FROM public.visitor_entries WHERE visitor_name = 'SSVQA Lakeview Guest'
);

INSERT INTO public.visitor_entries (society_id, resident_id, visitor_name, visitor_type, purpose, status)
SELECT '327fb699-542e-4ab6-b0b1-97022604bb88', 'f28747e8-5d4f-4363-9387-081098c2754d', 'SSVQA Greenfield Guest', 'guest', 'isolation seed', 'expected'
WHERE NOT EXISTS (
  SELECT 1 FROM public.visitor_entries WHERE visitor_name = 'SSVQA Greenfield Guest'
);

INSERT INTO public.society_notices (society_id, title, body, type, posted_by, is_active)
SELECT '94a7124c-a692-4d66-981f-0227b1317199', 'ssvqa-lv-notice', 'Lakeview isolation notice', 'general', '6e6cebbb-9e31-45aa-a0e3-7ff551f1c58d', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.society_notices WHERE title = 'ssvqa-lv-notice'
);

INSERT INTO public.society_notices (society_id, title, body, type, posted_by, is_active)
SELECT '327fb699-542e-4ab6-b0b1-97022604bb88', 'ssvqa-gf-notice', 'Greenfield isolation notice', 'general', 'f28747e8-5d4f-4363-9387-081098c2754d', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.society_notices WHERE title = 'ssvqa-gf-notice'
);
