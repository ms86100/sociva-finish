// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import { notify } from '@/lib/notify';

interface OrderCancellationProps {
  orderId: string;
  orderStatus: string;
  onCancelled: () => void;
  /** Whether buyer→cancelled transition is allowed by the workflow engine (required, DB-driven) */
  canCancel: boolean;
}

const DEFAULT_REASONS = [
  { value: 'changed_mind', label: 'Changed my mind' },
  { value: 'ordered_wrong', label: 'Ordered wrong items' },
  { value: 'taking_too_long', label: 'Taking too long to accept' },
  { value: 'found_alternative', label: 'Found an alternative' },
  { value: 'payment_issue', label: 'Payment issue' },
  { value: 'other', label: 'Other reason' },
];

export function OrderCancellation({ orderId, orderStatus, onCancelled, canCancel }: OrderCancellationProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  // Load cancellation reasons from DB
  const { getSetting } = useSystemSettingsRaw(['cancellation_reasons']);
  const rawReasons = getSetting('cancellation_reasons');
  let reasons = DEFAULT_REASONS;
  try {
    if (rawReasons) {
      const parsed = JSON.parse(rawReasons);
      if (Array.isArray(parsed) && parsed.length > 0) reasons = parsed;
    }
  } catch { /* use defaults */ }

  // Fully DB-driven: no hardcoded fallback
  const isEligible = canCancel;

  if (!isEligible) {
    return null;
  }

  const handleCancel = async () => {
    if (!reason) {
      notify.block('Please select a reason');
      return;
    }

    const finalReason = reason === 'other' ? otherReason : reasons.find(r => r.value === reason)?.label;

    if (reason === 'other' && !otherReason.trim()) {
      notify.block('Please enter your reason');
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.rpc('buyer_cancel_order', {
        _order_id: orderId,
        _reason: finalReason,
      });

      if (error) throw error;

      setIsOpen(false);

      toast.success('Order cancelled');
      // Trigger push notification to seller
      supabase.functions.invoke('process-notification-queue').catch(() => {});

      onCancelled();
    } catch (error: any) {
      console.error('Error cancelling order:', error);
      const errMsg = error?.message || error?.details || '';
      toast.error(errMsg.includes('Invalid status transition') ? 'This order cannot be cancelled at this stage' : errMsg.includes('notification_queue') ? 'Order cancelled, but seller notification failed. Retrying in the background.' : 'Failed to cancel order');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">
          <X size={16} className="mr-2" />
          Cancel Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-warning" size={20} />
            Cancel Order
          </DialogTitle>
          <DialogDescription>
            Please tell us why you want to cancel this order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <RadioGroup value={reason} onValueChange={setReason}>
            {reasons.map(({ value, label }) => (
              <div key={value} className="flex items-center space-x-2">
                <RadioGroupItem value={value} id={value} />
                <Label htmlFor={value} className="cursor-pointer">{label}</Label>
              </div>
            ))}
          </RadioGroup>

          {reason === 'other' && (
            <Textarea
              placeholder="Please describe your reason..."
              value={otherReason}
              onChange={(e) => setOtherReason(e.target.value)}
              rows={2}
            />
          )}

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setIsOpen(false)}
            >
              Keep Order
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="animate-spin mr-2" size={16} />
              ) : null}
              Cancel Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
