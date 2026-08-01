-- Grant permissions on user_notifications table
GRANT SELECT, INSERT, UPDATE ON public.user_notifications TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.user_notifications TO authenticated;
GRANT SELECT ON public.user_notifications TO anon;

-- Also ensure notification_queue has proper grants for service_role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_queue TO service_role;
GRANT SELECT ON public.notification_queue TO authenticated;