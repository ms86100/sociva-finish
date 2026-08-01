
-- Fix the overly permissive INSERT policy on user_notifications
-- Notifications are inserted by DB triggers (SECURITY DEFINER) and edge functions (service role)
-- Regular users should not insert directly
DROP POLICY "System can insert notifications" ON public.user_notifications;

CREATE POLICY "Authenticated users can insert notifications"
  ON public.user_notifications FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);
