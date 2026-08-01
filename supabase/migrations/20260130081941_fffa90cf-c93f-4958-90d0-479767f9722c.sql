-- Phase 3: Payments & Communication

-- Payment Records table
CREATE TABLE public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  buyer_id UUID NOT NULL,
  seller_id UUID REFERENCES public.seller_profiles(id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cod',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  transaction_reference TEXT,
  platform_fee DECIMAL(10,2) DEFAULT 0,
  net_amount DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat Messages table
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  message_text TEXT NOT NULL,
  read_status BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Payment Records policies
CREATE POLICY "Users can view their own payment records"
ON public.payment_records FOR SELECT
USING (
  buyer_id = auth.uid() OR 
  EXISTS (
    SELECT 1 FROM public.seller_profiles 
    WHERE id = seller_id AND user_id = auth.uid()
  ) OR
  public.is_admin(auth.uid())
);

CREATE POLICY "System can create payment records"
ON public.payment_records FOR INSERT
WITH CHECK (buyer_id = auth.uid());

CREATE POLICY "System can update payment records"
ON public.payment_records FOR UPDATE
USING (buyer_id = auth.uid() OR public.is_admin(auth.uid()));

-- Chat Messages policies
CREATE POLICY "Users can view their own chat messages"
ON public.chat_messages FOR SELECT
USING (
  sender_id = auth.uid() OR 
  receiver_id = auth.uid() OR
  public.is_admin(auth.uid())
);

CREATE POLICY "Users can send chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (sender_id = auth.uid());

CREATE POLICY "Users can mark messages as read"
ON public.chat_messages FOR UPDATE
USING (receiver_id = auth.uid());

-- Add payment_status to orders if not exists
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';

-- Enable realtime for chat
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- Update trigger for payment records
CREATE TRIGGER update_payment_records_updated_at 
BEFORE UPDATE ON public.payment_records 
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();