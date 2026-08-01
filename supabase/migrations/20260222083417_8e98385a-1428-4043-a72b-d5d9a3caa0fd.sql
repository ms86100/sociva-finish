
-- Add missing FK constraints that cause PostgREST 400 errors

-- reports: missing reported_seller_id and reported_user_id FKs
ALTER TABLE public.reports
  ADD CONSTRAINT reports_reported_seller_id_fkey FOREIGN KEY (reported_seller_id) REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- payment_records: missing buyer_id FK
ALTER TABLE public.payment_records
  ADD CONSTRAINT payment_records_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- warnings: missing issued_by FK
ALTER TABLE public.warnings
  ADD CONSTRAINT warnings_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Indexes for the new FK columns
CREATE INDEX IF NOT EXISTS idx_reports_reported_seller ON public.reports(reported_seller_id);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON public.reports(reported_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_records_buyer ON public.payment_records(buyer_id);
CREATE INDEX IF NOT EXISTS idx_warnings_issued_by ON public.warnings(issued_by);
