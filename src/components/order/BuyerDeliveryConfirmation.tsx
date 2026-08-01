// @ts-nocheck
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Package, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BuyerDeliveryConfirmationProps {
  orderId: string;
  sellerName?: string;
  onConfirmed: () => void;
}

export function BuyerDeliveryConfirmation({ orderId, sellerName, onConfirmed }: BuyerDeliveryConfirmationProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      const { error } = await supabase.rpc('buyer_confirm_delivery', { _order_id: orderId });
      if (error) throw error;
      setConfirmed(true);
      toast.success('Delivery confirmed! Thank you.', { id: `delivery-confirm-${orderId}` });
      // Fire notification processing
      supabase.functions.invoke('process-notification-queue').catch(() => {});
      setTimeout(onConfirmed, 1500);
    } catch (err: any) {
      console.error('Confirm delivery failed:', err);
      toast.error('Failed to confirm delivery. Please try again.', { id: `delivery-confirm-error-${orderId}` });
    } finally {
      setConfirming(false);
    }
  };

  return (
    <AnimatePresence>
      {!confirmed ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-primary/5 border-2 border-primary/20 rounded-xl p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Package size={20} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Did you receive your order?</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sellerName ? `From ${sellerName}` : 'Confirm to complete the order'}
              </p>
            </div>
          </div>
          <Button
            onClick={handleConfirm}
            disabled={confirming}
            className="w-full bg-primary text-primary-foreground h-11 gap-2"
          >
            {confirming ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle2 size={16} />
            )}
            {confirming ? 'Confirming...' : 'Yes, I received my order'}
          </Button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-accent/10 border border-accent/20 rounded-xl p-4 text-center"
        >
          <CheckCircle2 size={28} className="text-accent mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">Delivery Confirmed!</p>
          <p className="text-xs text-muted-foreground mt-0.5">Thank you for your order</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
