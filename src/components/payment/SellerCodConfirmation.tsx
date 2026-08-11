// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CheckCircle, Loader2, Banknote } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { useQueryClient } from '@tanstack/react-query';
import { friendlyError } from '@/lib/utils';

interface SellerCodConfirmationProps {
  orderId: string;
  amount: number;
  buyerName?: string;
  onConfirmed: () => void;
}

export function SellerCodConfirmation({
  orderId,
  amount,
  buyerName,
  onConfirmed,
}: SellerCodConfirmationProps) {
  const { formatPrice } = useCurrency();
  const [isUpdating, setIsUpdating] = useState(false);
  const queryClient = useQueryClient();

  const handleConfirm = async () => {
    setIsUpdating(true);
    try {
      const { error } = await supabase.rpc('confirm_cod_payment', {
        _order_id: orderId,
      });

      if (error) throw error;

      showFeedback({
        title: 'Cash payment confirmed',
        variant: 'success',
      });
      await queryClient.invalidateQueries({ queryKey: ['payment-record', orderId] });
      onConfirmed();
    } catch (err: any) {
      console.error('Failed to confirm COD payment:', err);
      toast.error(friendlyError(err), { id: 'seller-cod-confirm-error' });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-warning/20 flex items-center justify-center shrink-0">
          <Banknote size={18} className="text-warning" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Cash Payment Confirmation</p>
          <p className="text-xs text-muted-foreground mt-1">
            {buyerName || 'Buyer'} owes <span className="font-semibold text-foreground">{formatPrice(amount)}</span> (Cash on Delivery)
          </p>
          <p className="text-[11px] text-muted-foreground mt-2">
            Confirm only after receiving the cash. Seller-collected COD is tracked separately and is never added to your online payout balance.
          </p>
        </div>
      </div>

      <Button
        className="w-full gap-1.5"
        onClick={handleConfirm}
        disabled={isUpdating}
        size="sm"
      >
        {isUpdating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
        Mark Payment Received
      </Button>
    </div>
  );
}
