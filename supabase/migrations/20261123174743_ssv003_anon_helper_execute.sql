-- SSV-003 follow-up: public wrappers already return false/null for anon.
-- RLS on logged-out marketplace tables still calls them, so anon needs EXECUTE.
-- Do not grant get_user_auth_context (raises; not used in public SELECT policies).

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, user_role) TO anon;
GRANT EXECUTE ON FUNCTION public.is_society_admin(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.has_active_society_membership(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.conversations_is_member(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_access_feature(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_effective_society_features(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_write_to_society(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_write_to_society(uuid, uuid) TO authenticated, service_role;
