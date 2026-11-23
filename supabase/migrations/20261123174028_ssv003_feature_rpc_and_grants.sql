-- Second SSV-003 apply chunk: public wrapper grants.
-- Authenticated and service_role may execute wrappers.
-- Anon EXECUTE was added later (ssv003_anon_helper_execute) after marketplace 401s.

REVOKE ALL ON FUNCTION public.get_user_society_id(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_active_society_membership(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, user_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_society_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.conversations_is_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_auth_context(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_feature(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_effective_society_features(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_to_society(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_society_membership(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, user_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_society_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.conversations_is_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_auth_context(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_feature(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_effective_society_features(uuid) TO authenticated, service_role;
