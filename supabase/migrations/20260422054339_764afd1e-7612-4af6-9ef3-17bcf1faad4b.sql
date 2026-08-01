ALTER TABLE public.service_listings
ADD CONSTRAINT service_listings_product_id_key UNIQUE (product_id);

DROP INDEX IF EXISTS public.idx_service_listings_product;