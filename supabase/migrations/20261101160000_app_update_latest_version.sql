-- Soft update targeting: show Home banner only when installed version is below latest_version.

ALTER TABLE public.app_update_notices
  ADD COLUMN IF NOT EXISTS latest_version text;

COMMENT ON COLUMN public.app_update_notices.latest_version IS
  'Optional semver. When set, soft update banner shows only if installed app version is below this.';
