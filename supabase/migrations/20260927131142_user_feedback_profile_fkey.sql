-- The installed admin Feedback screen embeds profiles through this constraint.
-- Without it, PostgREST rejects the query and the screen shows an empty list.

ALTER TABLE public.user_feedback
  ADD CONSTRAINT user_feedback_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles (id)
  ON DELETE CASCADE;
