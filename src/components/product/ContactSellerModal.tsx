// @ts-nocheck
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, MessageCircle, User, Store, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CallFeedbackModal } from './CallFeedbackModal';
import { SellerChatSheet } from './SellerChatSheet';
import { supabase } from '@/integrations/supabase/client';
import { notify } from '@/lib/notify';
import { sellerCreditCustomerMessage } from '@/lib/sellerCredits';

interface ContactSellerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sellerName: string;
  sellerId: string;
  buyerId: string;
  productId: string;
  productName: string;
}

type ContactPhase = 'choose' | 'loading' | 'ready' | 'success';

export function ContactSellerModal({
  open, onOpenChange, sellerName,
  sellerId, buyerId, productId, productName,
}: ContactSellerModalProps) {
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [interactionId, setInteractionId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [phase, setPhase] = useState<ContactPhase>('choose');
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);

  const resetState = useCallback(() => {
    setPhase('choose');
    setPhone(null);
    setInteractionId(null);
    setOrderId(null);
    setBusy(false);
    actionLock.current = false;
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const initiateContact = useCallback(async (type: 'call' | 'message') => {
    if (!buyerId) {
      notify.block('Please sign in to contact this seller.');
      handleOpenChange(false);
      navigate('/auth');
      return null;
    }
    if (actionLock.current) return null;
    actionLock.current = true;
    setBusy(true);
    setPhase('loading');

    const { data, error } = await supabase.rpc('log_seller_contact_interaction', {
      p_seller_id: sellerId,
      p_product_id: productId,
      p_interaction_type: type,
    });

    setBusy(false);
    actionLock.current = false;

    if (error) {
      setPhase('choose');
      notify.block(sellerCreditCustomerMessage(error.message, 'CONTACT_REQUEST'));
      return null;
    }

    const row = data as Record<string, unknown> | null;
    const id = (row?.interaction_id as string) ?? null;
    const oid = (row?.order_id as string) ?? null;
    const revealedPhone = (row?.phone as string) ?? null;

    if (!id || !revealedPhone) {
      setPhase('choose');
      notify.block('Could not start contact. Please try again.');
      return null;
    }

    setInteractionId(id);
    setOrderId(oid);
    setPhone(revealedPhone);
    setPhase('success');

    supabase.functions.invoke('process-notification-queue').catch(() => {});

    return { id, oid, phone: revealedPhone, conversationId: row?.conversation_id as string | undefined };
  }, [buyerId, sellerId, productId, navigate, handleOpenChange]);

  const handleCall = async () => {
    const result = await initiateContact('call');
    if (!result?.phone) return;
    window.location.href = `tel:${result.phone}`;
    setTimeout(() => setFeedbackOpen(true), 5000);
  };

  const handleMessage = async () => {
    const result = await initiateContact('message');
    if (!result) return;
    handleOpenChange(false);
    setChatOpen(true);
  };

  const handleViewEnquiry = () => {
    if (orderId) {
      handleOpenChange(false);
      navigate(`/orders/${orderId}`);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Store size={18} className="text-primary" />
              Contact Seller
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={18} className="text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">{sellerName}</p>
                <p className="text-xs text-muted-foreground">Re: {productName}</p>
                {phone && phase === 'success' && (
                  <p className="text-sm text-muted-foreground mt-1">{phone}</p>
                )}
              </div>
            </div>

            {phase === 'loading' && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" size={16} />
                Connecting you to the seller…
              </div>
            )}

            {phase === 'success' && (
              <div className="rounded-lg border border-success/30 bg-success/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-success text-sm font-medium">
                  <CheckCircle2 size={16} />
                  Contact request sent
                </div>
                <p className="text-xs text-muted-foreground">
                  The seller has been notified. You can call, message, or track this enquiry anytime.
                </p>
                {orderId && (
                  <Button variant="outline" size="sm" className="w-full" onClick={handleViewEnquiry}>
                    View enquiry
                  </Button>
                )}
              </div>
            )}

            {phase === 'choose' && (
              <>
                <p className="text-xs text-muted-foreground px-1">
                  Your contact details will be shared with the seller when you proceed.
                </p>
                <Button
                  onClick={handleCall}
                  disabled={busy}
                  className="w-full gap-2"
                >
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <Phone size={16} />}
                  Call Seller
                </Button>
                <Button
                  variant="outline"
                  onClick={handleMessage}
                  disabled={busy}
                  className="w-full gap-2"
                >
                  {busy ? <Loader2 className="animate-spin" size={16} /> : <MessageCircle size={16} />}
                  Message
                </Button>
              </>
            )}

            {phase === 'success' && (
              <div className="flex gap-2">
                <Button onClick={handleCall} variant="outline" className="flex-1 gap-2" disabled={busy}>
                  <Phone size={16} /> Call again
                </Button>
                <Button onClick={handleMessage} className="flex-1 gap-2" disabled={busy}>
                  <MessageCircle size={16} /> Message
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <CallFeedbackModal
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        interactionId={interactionId}
        buyerId={buyerId}
        sellerId={sellerId}
        orderId={orderId}
        onMessage={() => { setFeedbackOpen(false); setChatOpen(true); }}
        onTryAgain={handleCall}
      />

      <SellerChatSheet
        open={chatOpen}
        onOpenChange={setChatOpen}
        buyerId={buyerId}
        sellerId={sellerId}
        productId={productId}
        productName={productName}
        sellerName={sellerName}
        orderId={orderId}
      />
    </>
  );
}
