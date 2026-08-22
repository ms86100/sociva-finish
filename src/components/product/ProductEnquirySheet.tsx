// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ProductActionType } from '@/types/Database';
import { Loader2, MessageCircle, Calendar, Send, Home, Handshake } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { notify } from '@/lib/notify';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { useChatViewport } from '@/hooks/useChatViewport';
import { sellerCreditCustomerMessage } from '@/lib/sellerCredits';

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

const QUICK_QUESTIONS: Record<string, string[]> = {
  book: ['Is my preferred time available?', 'How long does the service take?', 'What should I prepare beforehand?'],
  request_service: ['Can you help with this requirement?', 'What is the earliest availability?', 'What would the starting price be?'],
  request_quote: ['Can you share an itemised quote?', 'What details do you need from me?', 'How soon can this be completed?'],
  schedule_visit: ['Is a visit available this week?', 'What times are available?', 'Is there a visit charge?'],
  make_offer: ['Is the price negotiable?', 'Would you consider my offer?', 'Can I inspect it before deciding?'],
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { viewportHeight, keyboardInset } = useChatViewport(open);

  useEffect(() => {
    if (!open) return;
    const el = textareaRef.current;
    if (!el) return;
    const keepVisible = () => {
      window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
    };
    el.addEventListener('focus', keepVisible);
    return () => el.removeEventListener('focus', keepVisible);
  }, [open, keyboardInset]);

  const meta = ACTION_META[actionType] || ACTION_META.request_service;
  const Icon = meta.icon;
  const quickQuestions = QUICK_QUESTIONS[actionType] || [
    'Is this still available?',
    'Can you share more details?',
    'How soon can you respond?',
  ];

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

      const { data: productRow } = await supabase
        .from('products')
        .select('listing_type')
        .eq('id', productId)
        .maybeSingle();

      const idempotencyKey = `enquiry_${user.id}_${productId}_${Date.now()}`;
      const { data: created, error: orderError } = await supabase.rpc('create_enquiry_atomic', {
        p_seller_id: sellerId,
        p_product_id: productId,
        p_product_name: productName,
        p_message: `${message}${contactBlock}`,
        p_action_title: meta.title,
        p_price: price || 0,
        p_listing_type: (productRow as any)?.listing_type || null,
        p_idempotency_key: idempotencyKey,
      });
      if (orderError) throw orderError;
      const order = { id: created?.order_id };
      if (!order.id) throw new Error('Failed to send request');

      // Trigger immediate push notification to seller (fire-and-forget)
      supabase.functions.invoke('process-notification-queue').catch(() => {});

      showFeedback({
        title: 'Request sent! The seller will respond soon.',
        variant: 'success',
      });
      onOpenChange(false);
      setMessage('');
      navigate(`/orders/${order.id}`);
    } catch (error) {
      console.error('Error sending enquiry:', error);
      toast.error(sellerCreditCustomerMessage(error instanceof Error ? error.message : null, 'ENQUIRY_CREATED') || 'Failed to send request. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-h-[min(92dvh,100%)] overflow-y-auto"
        style={{
          bottom: keyboardInset,
          maxHeight: viewportHeight ? `${Math.max(viewportHeight - 12, 280)}px` : '92dvh',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
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
            <div>
              <p className="mb-1.5 text-[11px] text-muted-foreground">Quick questions · tap, then edit</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" aria-label="Quick question suggestions">
                {quickQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => setMessage(question)}
                    className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              ref={textareaRef}
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
