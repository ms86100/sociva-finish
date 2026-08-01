-- Mark all existing users as having seen onboarding so they don't see it again
UPDATE public.profiles SET has_seen_onboarding = true WHERE created_at < now();