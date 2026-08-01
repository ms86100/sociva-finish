// @ts-nocheck
import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { XCircle, Loader2, AlertTriangle } from 'lucide-react';

interface BuyerCancelBookingProps {
  bookingId: string;
  orderId: string;
  slotId: string;
  status: string;
}

/** DB-driven terminal status check — cached per session */
let terminalBookingStatuses: Set<string> | null = null;
async function loadTerminalBookingStatuses(): Promise<Set<string>> {
  if (terminalBookingStatuses) return terminalBookingStatuses;
  const { data } = await supabase
    .from('category_status_flows')
    .select('status_key')
    .eq('is_terminal', true);
  // Include in_progress as non-cancellable (it's active, not terminal, but cancellation is blocked)
  const set = new Set<string>(data?.map(r => r.status_key) ?? []);
  set.add('in_progress');
  terminalBookingStatuses = set;
  return set;
}

export function BuyerCancelBooking({ bookingId, orderId, slotId, status }: BuyerCancelBookingProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [policyInfo, setPolicyInfo] = useState<{ can_cancel: boolean; fee_percentage: number; reason: string } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [hidden, setHidden] = useState(true);

  // DB-driven terminal check on mount
  useEffect(() => {
    loadTerminalBookingStatuses().then(set => {
      setHidden(set.has(status));
    });
  }, [status]);

  if (hidden) return null;

  const checkPolicy = async () => {
    if (!user) return;
    setIsChecking(true);
    setPolicyInfo(null);
    try {
      const { data, error } = await supabase.rpc('can_cancel_booking', {
        _booking_id: bookingId,
        _actor_id: user.id,
      });
      if (error) throw error;
      setPolicyInfo(data as any);
    } catch {
      setPolicyInfo({ can_cancel: false, fee_percentage: 0, reason: 'Unable to check cancellation policy. Please try again.' });
    } finally {
      setIsChecking(false);
    }
  };

  const handleCancel = async () => {
    if (!user || isCancelling) return;
    setIsCancelling(true);
    try {
      // Bug #19 fix: Use buyer_cancel_order RPC to respect workflow transitions
      const { error: rpcError } = await supabase.rpc('buyer_cancel_order', {
        _order_id: orderId,
        _reason: reason.trim().slice(0, 500) || 'No reason provided',
      });

      if (rpcError) throw rpcError;

      // Update booking status (the order is already cancelled by the RPC)
      await supabase
        .from('service_bookings')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason.trim().slice(0, 500) || 'No reason provided',
        })
        .eq('id', bookingId)
        .eq('buyer_id', user.id);

      // Release the slot
      if (slotId) {
        await supabase.rpc('release_service_slot', { _slot_id: slotId });
      }

      // Send notification to seller
      const { data: bookingData } = await supabase
        .from('service_bookings')
        .select('seller_id, booking_date, start_time, product_id')
        .eq('id', bookingId)
        .maybeSingle();

      if (bookingData?.seller_id) {
        const { data: sellerProfile } = await supabase
          .from('seller_profiles')
          .select('user_id')
          .eq('id', bookingData.seller_id)
          .single();

        if (sellerProfile?.user_id) {
          const { data: product } = await supabase
            .from('products')
            .select('name')
            .eq('id', bookingData.product_id)
            .single();

          await supabase.from('notification_queue').insert({
            user_id: sellerProfile.user_id,
            type: 'order',
            title: '📋 Booking Cancelled by Buyer',
            body: `A booking for ${product?.name || 'your service'} on ${bookingData.booking_date} at ${bookingData.start_time?.slice(0, 5)} has been cancelled.`,
            reference_path: `/orders/${orderId}`,
            payload: { orderId, status: 'cancelled', type: 'order' },
          });
          supabase.functions.invoke('process-notification-queue').catch(() => {});
        }
      }

      queryClient.invalidateQueries({ queryKey: ['service-booking-order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['service-slots'] });
      queryClient.invalidateQueries({ queryKey: ['seller-service-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['order-detail'] });

      window.dispatchEvent(new Event('booking-changed'));

      toast.success('Booking cancelled');
      setIsOpen(false);
    } catch (err: any) {
      const msg = err?.message?.includes('Invalid status transition')
        ? 'This booking cannot be cancelled from its current status.'
        : 'Failed to cancel booking';
      toast.error(msg);
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => {
      if (isCancelling) return;
      setIsOpen(open);
      if (open) {
        setReason('');
        checkPolicy();
      }
    }}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10">
          <XCircle size={14} /> Cancel Booking
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Booking?</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            {isChecking ? (
              <span className="flex items-center gap-2"><Loader2 className="animate-spin" size={14} /> Checking cancellation policy...</span>
            ) : policyInfo ? (
              <>
                {!policyInfo.can_cancel ? (
                  <span className="text-destructive flex items-center gap-1.5">
                    <AlertTriangle size={14} /> {policyInfo.reason}
                  </span>
                ) : (
                  <>
                    <span>{policyInfo.reason}</span>
                    {policyInfo.fee_percentage > 0 && (
                      <span className="block font-medium text-destructive">
                        ⚠️ A {policyInfo.fee_percentage}% cancellation fee will apply.
                      </span>
                    )}
                  </>
                )}
              </>
            ) : (
              <span>Are you sure you want to cancel this booking?</span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {policyInfo?.can_cancel && (
          <Textarea
            placeholder="Reason for cancellation (optional)..."
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            rows={2}
            maxLength={500}
          />
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCancelling}>Keep Booking</AlertDialogCancel>
          {policyInfo?.can_cancel && (
            <Button
              onClick={handleCancel}
              disabled={isCancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isCancelling && <Loader2 className="animate-spin mr-1" size={14} />}
              Confirm Cancellation
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
