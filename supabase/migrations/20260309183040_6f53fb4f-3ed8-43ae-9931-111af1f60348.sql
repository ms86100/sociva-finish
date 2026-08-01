-- Add missing foreign keys for warnings and reports tables
ALTER TABLE public.warnings
  ADD CONSTRAINT warnings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id),
  ADD CONSTRAINT warnings_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.profiles(id);

ALTER TABLE public.reports
  ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.profiles(id),
  ADD CONSTRAINT reports_reported_seller_id_fkey FOREIGN KEY (reported_seller_id) REFERENCES public.seller_profiles(id);