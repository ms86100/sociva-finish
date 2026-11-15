-- Enable in-app VoIP gating for buyer/seller order calling.
-- livekit_configured remains admin/ops-owned; the client also treats
-- voip-call capabilities.livekit_env_present as configured so secrets
-- already on the edge function unlock Call in Sociva without a second DB flip.
UPDATE public.voip_runtime_config
SET
  enabled = true,
  notes = trim(both FROM COALESCE(notes, '') || ' Enabled for Sociva order calling (master reliability restore).'),
  updated_at = now()
WHERE id = 1;
