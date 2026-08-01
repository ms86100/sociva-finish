-- Phase 3a: Add awaiting_cod_confirmation enum (separate txn from usage)
ALTER TYPE public.order_status ADD VALUE IF NOT EXISTS 'awaiting_cod_confirmation';
