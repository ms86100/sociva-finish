-- Add status column to order_items for per-item tracking
ALTER TABLE public.order_items 
ADD COLUMN status TEXT DEFAULT 'pending';

-- Add item-level tracking fields
ALTER TABLE public.order_items
ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Create trigger to update updated_at on order_items
CREATE TRIGGER update_order_items_updated_at
BEFORE UPDATE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- Add index for faster status queries
CREATE INDEX idx_order_items_status ON public.order_items(status);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);