// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ProductActionType } from '@/types/database';
import { Loader2, MessageCircle, Calendar, Send, Home, Handshake } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { notify } from '@/lib/notify';

interface ProductEnquirySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  sellerId: string;
  sellerName: string;
  actionType: ProductActionType;
  price?: number;
}

const ACTION_META: Record<string, { title: string; icon: typeof Send; placeholder: string; submitLabel: string }> = {
  book: {
    title: 'Book Service',
    icon: Calendar,
    placeholder: 'When would you like to book? Any preferences for date/time?',
    submitLabel: 'Send Booking Request',
  },
  request_service: {
    title: 'Request Service',
    icon: Send,
    placeholder: 'Describe what you need — scope, timing, any specific requirements…',
    submitLabel: 'Send Request',
  },
  request_quote: {
    title: 'Request Quote',
    icon: MessageCircle,
    placeholder: 'Describe your requirements so the seller can provide an accurate quote…',
    submitLabel: 'Request Quote',
  },
  schedule_visit: {
    title: 'Schedule a Visit',
    icon: Home,
    placeholder: 'When would you like to visit? Any preferred dates or times?',
    submitLabel: 'Request Visit',
  },
  make_offer: {
    title: 'Make an Offer',
    icon: Handshake,
    placeholder: 'What price are you offering? Include any conditions or notes…',
    submitLabel: 'Send Offer',
  },
};

export function ProductEnquirySheet({
  open,
  onOpenChange,
  productId,
  productName,
  sellerId,
  sellerName,
  actionType,
  price,
}: ProductEnquirySheetProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const meta = ACTION_META[actionType] || ACTION_META.request_service;
  const Icon = meta.icon;

  const handleSubmit = async () => {
    if (!user) {
      notify.block('Please sign in first');
      navigate('/auth');
      return;
    }

    if (!message.trim()) {
      notify.block('Please enter a message');
      return;
    }

    setIsLoading(true);
    try {
      // Resolve seller's user_id (chat_messages.receiver_id must be a user UUID, not seller_profiles.id)
      const { data: sellerData } = await supabase
        .from('seller_profiles')
        .select('user_id')
        .eq('id', sellerId)
        .single();

      const sellerUserId = sellerData?.user_id;
      if (!sellerUserId) throw new Error('Could not resolve seller user');

      // Fetch buyer contact details to share with seller
      const { data: buyerProfile } = await supabase
        .from('profiles')
        .select('name, phone, email')
        .eq('id', user.id)
        .single();

      const buyerName = buyerProfile?.name || 'Customer';
      const buyerPhone = buyerProfile?.phone || '';
      const buyerEmail = buyerProfile?.email || user.email || '';

      // Build contact block for the chat message
      const contactLines: string[] = [];
      if (buyerPhone) contactLines.push(`📞 ${buyerPhone}`);
      if (buyerEmail) contactLines.push(`📧 ${buyerEmail}`);
      const contactBlock = contactLines.length > 0
        ? `\n\n--- Contact Details ---\n${contactLines.join('\n')}`
        : '';

      // Create an enquiry order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          buyer_id: user.id,
          seller_id: sellerId,
          total_amount: price || 0,
          order_type: 'enquiry',
          status: 'enquired',
          notes: `${meta.title} for: ${productName}\n\n${message}`,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      // Create order_item linking enquiry to specific product
      await supabase.from('order_items').insert({
        order_id: order.id,
        product_id: productId,
        product_name: productName,
        quantity: 1,
        unit_price: price || 0,
      });

      // Create initial chat message with buyer details, using seller's user_id as receiver
      const { error: chatError } = await supabase
        .from('chat_messages')
        .insert({
          order_id: order.id,
          sender_id: user.id,
          receiver_id: sellerUserId,
          message_text: `Hi! I'd like to ${meta.title.toLowerCase()} for "${productName}".\n\n${message}${contactBlock}`,
        });

      if (chatError) throw chatError;

      // Trigger immediate push notification to seller (fire-and-forget)
      supabase.functions.invoke('process-notification-queue').catch(() => {});

      toast.success('Request sent! The seller will respond soon.');
      onOpenChange(false);
      setMessage('');
      navigate(`/orders/${order.id}`);
    } catch (error) {
      console.error('Error sending enquiry:', error);
      toast.error('Failed to send request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-3">
          <DrawerTitle className="flex items-center gap-2">
            <Icon size={18} className="text-primary" />
            {meta.title}
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-6">
          {/* Product summary */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-medium text-sm">{productName}</p>
            <p className="text-xs text-muted-foreground">
              by {sellerName}
              {price ? ` · ${formatPrice(price)}` : ''}
            </p>
          </div>

          {/* Message */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Your Message</label>
            <Textarea
              placeholder={meta.placeholder}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Submit */}
          <Button
            className="w-full"
            size="lg"
            disabled={isLoading || !message.trim()}
            onClick={handleSubmit}
          >
            {isLoading ? (
              <Loader2 className="animate-spin mr-2" size={16} />
            ) : (
              <Icon size={16} className="mr-2" />
            )}
            {meta.submitLabel}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Your contact details will be shared with the seller
          </p>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
