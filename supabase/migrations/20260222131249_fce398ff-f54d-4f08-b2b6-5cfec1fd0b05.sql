
-- Phase 4: Enable realtime on role/permission tables for instant UI updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.security_staff;
ALTER PUBLICATION supabase_realtime ADD TABLE public.society_admins;
ALTER PUBLICATION supabase_realtime ADD TABLE public.builder_members;
