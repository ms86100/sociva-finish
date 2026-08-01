-- Add missing enum values to order_status
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'confirmed';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'no_show';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'requested';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'rescheduled';
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'at_gate';