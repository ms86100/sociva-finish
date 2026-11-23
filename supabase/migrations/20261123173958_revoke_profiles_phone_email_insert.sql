-- SSV-001 follow-up: OTP service-role already writes phone/email.
-- authenticated does not need INSERT on those columns.

REVOKE INSERT (phone, email) ON public.profiles FROM PUBLIC, anon, authenticated;
