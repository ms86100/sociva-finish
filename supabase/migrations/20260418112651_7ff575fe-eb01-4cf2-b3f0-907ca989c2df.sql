-- Make OTP a strictly delivery-time gate, controlled exclusively by the workflow editor.
-- Remove OTP requirement from any "picked_up" steps so OTP is no longer triggered at pickup.
UPDATE public.category_status_flows
SET requires_otp = false,
    otp_type = NULL
WHERE status_key = 'picked_up'
  AND (requires_otp = true OR otp_type IS NOT NULL);

-- Safety: ensure self_pickup flows keep OTP on the actual handover step (status_key='picked_up' with is_terminal=true is the buyer collection moment for self-pickup).
-- Re-enable ONLY for self_pickup terminal pickup, since that IS the delivery/handover moment for that flow.
UPDATE public.category_status_flows
SET requires_otp = true,
    otp_type = 'generic'
WHERE status_key = 'picked_up'
  AND transaction_type = 'self_pickup'
  AND is_terminal = true;