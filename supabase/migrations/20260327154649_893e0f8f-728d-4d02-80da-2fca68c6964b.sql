-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

-- Trigram index for autocomplete fallback on product names
CREATE INDEX IF NOT EXISTS idx_products_name_trgm 
ON public.products USING GIN (name public.gin_trgm_ops);