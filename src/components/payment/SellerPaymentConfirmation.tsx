// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Loader2, CreditCard, ImageIcon } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

interface SellerPaymentConfirmationProps {
  orderId: string;
  amount: number;
  utrRef: string | null;
  buyerName?: string;
  screenshotUrl?: string | null;
  onConfirmed: () => void;
}

export function SellerPaymentConfirmation({
  orderId,
  amount,
  utrRef,
  buyerName,
  screenshotUrl,
  onConfirmed,
}: SellerPaymentConfirmationProps) {
  const { formatPrice } = useCurrency();
  const [isUpdating, setIsUpdating] = useState(false);
  const [showFullImage, setShowFullImage] = useState(false);

  const handleConfirm = async (received: boolean) => {
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('verify_seller_payment', {
        _order_id: orderId,
        _received: received,
      });

      if (error) throw error;

      // Notify buyer
      const { data: order } = await supabase
        .from('orders')
        .select('buyer_id')
        .eq('id', orderId)
        .single();

      if (order) {
        const shortId = orderId.slice(0, 8).toUpperCase();
        await supabase.from('notification_queue').insert({
          user_id: order.buyer_id,
          type: 'order',
          title: received ? '✅ Payment Verified' : '⚠️ Payment Dispute',
          body: received
            ? `Your UPI payment for Order #${shortId} has been confirmed by the seller.`
            : `The seller could not verify your payment for Order #${shortId}. Please contact them.`,
          reference_path: `/orders/${orderId}`,
          payload: { orderId, status: received ? 'paid' : 'disputed', type: 'order' },
        } as any);

        supabase.functions.invoke('process-notification-queue').catch(() => {});
      }

      toast.success(received ? 'Payment confirmed' : 'Payment marked as not received');
      onConfirmed();
    } catch (err) {
      console.error('Failed to update payment confirmation:', err);
      toast.error('Failed to update payment status');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <>
      <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
            <CreditCard size={18} className="text-warning" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Payment Verification Required</p>
            <p className="text-xs text-muted-foreground mt-1">
              {buyerName || 'Buyer'} claims UPI payment of <span className="font-semibold text-foreground">{formatPrice(amount)}</span>
            </p>
            {utrRef && (
              <div className="mt-2 bg-background rounded-lg px-3 py-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Transaction ID (UTR)</p>
                <p className="text-sm font-mono font-semibold mt-0.5">{utrRef}</p>
              </div>
            )}

            {/* Payment proof screenshot */}
            {screenshotUrl ? (
              <div className="mt-2">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <ImageIcon size={10} /> Payment Proof
                </p>
                <button
                  onClick={() => setShowFullImage(true)}
                  className="block rounded-lg overflow-hidden border border-border hover:border-primary/40 transition-colors"
                >
                  <img
                    src={screenshotUrl}
                    alt="Payment screenshot"
                    className="w-full max-h-32 object-cover bg-muted/30"
                  />
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-2 italic">No payment proof attached</p>
            )}

            <p className="text-[11px] text-muted-foreground mt-2">
              Check your bank/UPI app for this payment and confirm below
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground gap-1.5"
            onClick={() => handleConfirm(false)}
            disabled={isUpdating}
            size="sm"
          >
            {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Not Received
          </Button>
          <Button
            className="flex-1 gap-1.5"
            onClick={() => handleConfirm(true)}
            disabled={isUpdating}
            size="sm"
          >
            {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Payment Received
          </Button>
        </div>
      </div>

      {/* Full-size image dialog */}
      <Dialog open={showFullImage} onOpenChange={setShowFullImage}>
        <DialogContent className="sm:max-w-lg p-2">
          {screenshotUrl && (
            <img
              src={screenshotUrl}
              alt="Payment screenshot"
              className="w-full rounded-xl object-contain max-h-[70vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
