-- Grant INSERT on notification_queue to authenticated users.
-- The RLS INSERT policy ("Authenticated users can enqueue their own notifications")
-- already allows this, but PostgREST blocks the request before RLS runs because
-- the table-level GRANT for `authenticated` only included SELECT. This caused
-- the in-app "Check Notifications" test to fail with a permission error on
-- every device. Without INSERT/UPDATE here, server-side triggers (which run
-- as service_role) still work, but the user-initiated diagnostic could not.
GRANT INSERT ON public.notification_queue TO authenticated;