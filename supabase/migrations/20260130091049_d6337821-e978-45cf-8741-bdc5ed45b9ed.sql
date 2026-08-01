-- Add missing foreign key relationships for proper joins
-- Using DO block to handle existing constraints gracefully

DO $$
BEGIN
    -- orders.buyer_id -> profiles.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'orders_buyer_id_fkey' 
        AND table_name = 'orders'
    ) THEN
        ALTER TABLE public.orders
        ADD CONSTRAINT orders_buyer_id_fkey
        FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;

    -- reviews.buyer_id -> profiles.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'reviews_buyer_id_fkey' 
        AND table_name = 'reviews'
    ) THEN
        ALTER TABLE public.reviews
        ADD CONSTRAINT reviews_buyer_id_fkey
        FOREIGN KEY (buyer_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
    END IF;

    -- reports.reporter_id -> profiles.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'reports_reporter_id_fkey' 
        AND table_name = 'reports'
    ) THEN
        ALTER TABLE public.reports
        ADD CONSTRAINT reports_reporter_id_fkey
        FOREIGN KEY (reporter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;

    -- warnings.user_id -> profiles.id
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'warnings_user_id_fkey' 
        AND table_name = 'warnings'
    ) THEN
        ALTER TABLE public.warnings
        ADD CONSTRAINT warnings_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
    END IF;
END $$;