-- Staging only (wwuanzbusxoyzixuprxs). SSV-006 follow-up.
-- Table-level SELECT implies every column, so REVOKE (otp_code) cannot hide OTP.
-- Grant only non-secret columns. Residents load OTP via visitor_list_own_otps.
-- Do not apply on production kkzkuyhgdvyecmxtmkpy.

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.visitor_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, society_id, resident_id, visitor_name, visitor_phone, visitor_type, purpose,
  expected_date, expected_time, otp_expires_at, is_preapproved, is_recurring,
  recurring_days, status, checked_in_at, checked_out_at, vehicle_number, photo_url,
  flat_number, guard_notes, created_at, updated_at, parking_slot_id
) ON public.visitor_entries TO authenticated;
