// @ts-nocheck
import { useState, useCallback } from 'react';
import { Phone, MessageCircle, User, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CallFeedbackModal } from './CallFeedbackModal';
import { SellerChatSheet } from './SellerChatSheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { notify } from '@/lib/notify';

interface ContactSellerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sellerName: string;
  phone: string;
  sellerId: string;
  buyerId: string;
  productId: string;
  productName: string;
}

export function ContactSellerModal({
  open, onOpenChange, sellerName, phone,
  sellerId, buyerId, productId, productName,
}: ContactSellerModalProps) {
  const [chatOpen, setChatOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);

  const logInteraction = useCallback(async (type: 'call' | 'message') => {
    try {
      const { data } = await supabase
        .from('seller_contact_interactions')
        .insert({ buyer_id: buyerId, seller_id: sellerId, product_id: productId, interaction_type: type })
        .select('id')
        .single();
      return data?.id ?? null;
    } catch { return null; }
  }, [buyerId, sellerId, productId]);

  const handleCall = async () => {
    const id = await logInteraction('call');
    setInteractionId(id);
    window.location.href = `tel:${phone}`;
    // Prompt feedback after delay
    setTimeout(() => setFeedbackOpen(true), 5000);
  };

  const handleMessage = async () => {
    if (!buyerId) {
      notify.block('Please sign in to message this seller.');
      onOpenChange(false);
      return;
    }
    await logInteraction('message');
    onOpenChange(false);
    setChatOpen(true);
  };

  const hasPhone = !!phone;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Store size={18} className="text-primary" />
              Contact Seller
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {/* Seller info card */}
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={18} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">{sellerName}</p>
                {hasPhone && <p className="text-sm text-muted-foreground">{phone}</p>}
              </div>
            </div>

            {/* Call Now */}
            <Button
              onClick={handleCall}
              disabled={!hasPhone}
              className="w-full gap-2"
            >
              <Phone size={16} />
              {hasPhone ? 'Call Now' : 'Phone not available'}
            </Button>

            {/* Message */}
            <Button
              variant="outline"
              onClick={handleMessage}
              className="w-full gap-2"
            >
              <MessageCircle size={16} />
              Message
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CallFeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        interactionId={interactionId}
        buyerId={buyerId}
        sellerId={sellerId}
      />

      <SellerChatSheet
        open={chatOpen}
        onOpenChange={setChatOpen}
        buyerId={buyerId}
        sellerId={sellerId}
        productId={productId}
        productName={productName}
        sellerName={sellerName}
      />
    </>
  );
}
