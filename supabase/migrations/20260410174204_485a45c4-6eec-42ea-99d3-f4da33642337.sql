-- Fix: make period_start and period_end nullable so the per-order settlement trigger doesn't crash
ALTER TABLE seller_settlements ALTER COLUMN period_start DROP NOT NULL;
ALTER TABLE seller_settlements ALTER COLUMN period_end DROP NOT NULL;