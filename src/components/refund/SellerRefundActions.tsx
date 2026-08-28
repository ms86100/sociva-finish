// @ts-nocheck
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Clock,
  AlertTriangle,
  MessageCircle,
  Phone,
  IndianRupee,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cardEntrance } from '@/lib/motion-variants';
import { notify } from '@/lib/notify';
import { friendlyError } from '@/lib/utils';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { BuyerTrustProfileCard } from './BuyerTrustProfileCard';
import { OrderPaymentBreakdownCard } from '@/components/order/OrderPaymentBreakdownCard';
import {
  normalizeSocivaBalanceRefundEligibility,
  sellerRefundUnavailableCopy,
} from '@/lib/sociva-balance-refund-eligibility';

interface SellerRefundActionsProps {
  refundId: string;
  orderId: string;
  buyerId: string;
  refundStatus: string;
  refundAmount: number;
  requestedAmount?: number | null;
  approvedAmount?: number | null;
  refundReason: string;
  refundCategory: string;
  createdAt: string;
  evidenceUrls?: string[];
  buyerPhone?: string | null;
  canChat?: boolean;
  onChatOpen?: () => void;
  onActionComplete?: () => void;
  order?: {
    total_amount?: number | null;
    frozen_total?: number | null;
    wallet_cash_amount?: number | null;
    wallet_promo_amount?: number | null;
    loyalty_discount_amount?: number | null;
    coupon_discount?: number | null;
    payment_type?: string | null;
    payment_method?: string | null;
    payment_status?: string | null;
  };
  settlementNet?: number | null;
  settlementStatus?: string | null;
}

type PanelMode = 'actions' | 'reject' | 'partial' | 'info';

export function SellerRefundActions({
  refundId,
  orderId,
  buyerId,
  refundStatus,
  refundAmount,
  requestedAmount,
  approvedAmount,
  refundReason,
  refundCategory,
  createdAt,
  evidenceUrls = [],
  buyerPhone,
  canChat = false,
  onChatOpen,
  onActionComplete,
  order,
  settlementNet,
  settlementStatus,
}: SellerRefundActionsProps) {
  const [acting, setActing] = useState(false);
  const [panel, setPanel] = useState<PanelMode>('actions');
  const [rejectionReason, setRejectionReason] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [partialAmount, setPartialAmount] = useState('');

  const cap = Number(requestedAmount ?? refundAmount) || 0;
  const isPending = refundStatus === 'requested';

  const { data: refundEligibility } = useQuery({
    queryKey: ['sociva-balance-refund-eligibility', orderId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_sociva_balance_refund_eligibility', {
        p_order_id: orderId,
      });
      if (error) throw error;
      return normalizeSocivaBalanceRefundEligibility(data);
    },
    enabled: !!orderId && isPending,
    staleTime: 30_000,
  });

  const canIssueBalanceRefund = refundEligibility?.eligible === true;

  async function respond(
    action: 'approve_full' | 'approve_partial' | 'reject' | 'request_info',
    amount?: number,
    message?: string,
  ) {
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('seller_respond_refund', {
        p_refund_id: refundId,
        p_action: action,
        p_amount: amount ?? null,
        p_message: message ?? null,
      });
      if (error) throw error;

      if (action === 'reject') {
        showFeedback({ title: 'Refund rejected', variant: 'success' });
      } else if (action === 'request_info') {
        showFeedback({ title: 'Message sent to buyer', variant: 'success' });
      } else {
        const approved = Number((data as any)?.approved_amount ?? amount ?? cap);
        showFeedback({
          title: `₹${approved} added to Sociva Balance`,
          description: 'Buyer received instant wallet credit. Your settlement is adjusted.',
          variant: 'success',
        });
      }

      setPanel('actions');
      onActionComplete?.();
    } catch (err: any) {
      toast.error(friendlyError(err), { id: 'refund-respond-error' });
    } finally {
      setActing(false);
    }
  }

  async function handleApproveFull() {
    await respond('approve_full');
  }

  async function handleReject() {
    if (!rejectionReason.trim() || rejectionReason.trim().length < 5) {
      notify.block('Please provide a reason for rejection (min 5 characters)');
      return;
    }
    await respond('reject', undefined, rejectionReason.trim());
  }

  async function handlePartial() {
    const amt = Number(partialAmount);
    if (!Number.isFinite(amt) || amt <= 0 || amt > cap) {
      notify.block(`Enter an amount between ₹1 and ₹${cap}`);
      return;
    }
    await respond('approve_partial', amt);
  }

  async function handleRequestInfo() {
    if (!infoMessage.trim() || infoMessage.trim().length < 5) {
      notify.block('Please write a message (min 5 characters)');
      return;
    }
    await respond('request_info', undefined, infoMessage.trim());
  }

  const categoryLabels: Record<string, string> = {
    order_issue: 'Order Issue',
    quality_issue: 'Quality Problem',
    wrong_item: 'Wrong Item',
    not_received: 'Not Received',
    seller_cancelled: 'Seller Cancelled',
    other: 'Other',
  };

  const isApproved = ['approved', 'refund_initiated', 'refund_processing'].includes(refundStatus);
  const isCompleted = refundStatus === 'refund_completed';
  const isRejected = refundStatus === 'rejected';
  const isFailed = refundStatus === 'refund_failed';

  const containerClass = isCompleted
    ? 'bg-success/5 border border-success/20'
    : isApproved
      ? 'bg-primary/5 border border-primary/20'
      : isRejected || isFailed
        ? 'bg-destructive/5 border border-destructive/20'
        : 'bg-warning/5 border border-warning/20';

  return (
    <motion.div variants={cardEntrance} className={`${containerClass} rounded-xl p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCompleted ? <CheckCircle2 size={16} className="text-success" /> :
           isRejected || isFailed ? <XCircle size={16} className="text-destructive" /> :
           <ShieldCheck size={16} className="text-primary" />}
          <p className="text-sm font-semibold">Refund Request</p>
        </div>
        {isPending && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-warning/10 text-warning flex items-center gap-1">
            <Clock size={10} /> Awaiting Response
          </span>
        )}
        {isApproved && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-primary/10 text-primary flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> Processing
          </span>
        )}
        {isCompleted && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-success/10 text-success flex items-center gap-1">
            <CheckCircle2 size={10} /> Settled
          </span>
        )}
        {isRejected && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-destructive/10 text-destructive flex items-center gap-1">
            <XCircle size={10} /> Rejected
          </span>
        )}
      </div>

      {isPending && buyerId && <BuyerTrustProfileCard buyerId={buyerId} compact />}

      {order && (
        <OrderPaymentBreakdownCard
          order={order}
          settlementNet={settlementNet}
          settlementStatus={settlementStatus}
          compact
          title="Order payment"
        />
      )}

      <div className="bg-background/60 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Requested</span>
          <span className="text-sm font-bold">₹{cap}</span>
        </div>
        {approvedAmount != null && approvedAmount > 0 && approvedAmount !== cap && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Approved</span>
            <span className="text-sm font-bold text-success">₹{approvedAmount}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Category</span>
          <span className="text-xs font-medium">{categoryLabels[refundCategory] || refundCategory}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Submitted</span>
          <span className="text-[11px] text-muted-foreground">
            {new Date(createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground pt-1 border-t border-border/50">
          "{refundReason}"
        </p>
        {evidenceUrls.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground mb-1.5">Buyer evidence ({evidenceUrls.length})</p>
            <div className="flex gap-1.5 flex-wrap">
              {evidenceUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block w-14 h-14 rounded-md overflow-hidden border border-border">
                  <img src={url} alt="evidence" className="w-full h-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {isPending && (
        <>
          {canIssueBalanceRefund ? (
            <div className="flex items-center gap-1.5 px-1">
              <IndianRupee size={12} className="text-primary shrink-0" />
              <p className="text-[10px] text-muted-foreground">
                Approved refunds are credited instantly as Sociva Balance. Your payout is adjusted.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">
                {sellerRefundUnavailableCopy(refundEligibility ?? null)}
              </p>
            </div>
          )}

          <div className="flex gap-2">
            {canChat && onChatOpen && (
              <Button variant="outline" size="sm" className="flex-1" onClick={onChatOpen} disabled={acting}>
                <MessageCircle size={14} className="mr-1" /> Chat
              </Button>
            )}
            {buyerPhone && (
              <Button variant="outline" size="sm" className="flex-1" asChild disabled={acting}>
                <a href={`tel:${buyerPhone}`}>
                  <Phone size={14} className="mr-1" /> Call
                </a>
              </Button>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-1">
            <AlertTriangle size={12} className="text-warning shrink-0" />
            <p className="text-[10px] text-muted-foreground">You have 48 hours to respond. Auto-approval applies after deadline.</p>
          </div>

          <AnimatePresence mode="wait">
            {panel === 'actions' && (
              <motion.div
                key="actions"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-2"
              >
                {canIssueBalanceRefund ? (
                  <>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPanel('reject')}
                        disabled={acting}
                        className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                      >
                        <XCircle size={14} className="mr-1" /> Reject
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPanel('partial')}
                        disabled={acting}
                        className="flex-1"
                      >
                        Partial
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPanel('info')}
                        disabled={acting}
                        className="flex-1"
                      >
                        Ask for info
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleApproveFull}
                        disabled={acting}
                        className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                      >
                        {acting ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle2 size={14} className="mr-1" />}
                        Approve full
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPanel('info')}
                      disabled={acting}
                      className="flex-1"
                    >
                      Request information
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPanel('reject')}
                      disabled={acting}
                      className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                    >
                      <XCircle size={14} className="mr-1" /> Reject / Resolve
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {panel === 'reject' && (
              <motion.div key="reject" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-2">
                <Textarea
                  placeholder="Why are you rejecting this refund?"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPanel('actions')} disabled={acting} className="flex-1">Back</Button>
                  <Button size="sm" variant="destructive" onClick={handleReject} disabled={acting || rejectionReason.trim().length < 5} className="flex-1">
                    Confirm reject
                  </Button>
                </div>
              </motion.div>
            )}

            {panel === 'partial' && (
              <motion.div key="partial" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-2">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">Partial Sociva Balance amount (max ₹{cap})</p>
                  <Input
                    type="number"
                    min={1}
                    max={cap}
                    step="0.01"
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(e.target.value)}
                    placeholder={`Up to ${cap}`}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPanel('actions')} disabled={acting} className="flex-1">Back</Button>
                  <Button size="sm" onClick={handlePartial} disabled={acting} className="flex-1 bg-success text-success-foreground">
                    Approve partial
                  </Button>
                </div>
              </motion.div>
            )}

            {panel === 'info' && (
              <motion.div key="info" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="space-y-2">
                <Textarea
                  placeholder="What details or photos do you need from the buyer?"
                  value={infoMessage}
                  onChange={(e) => setInfoMessage(e.target.value)}
                  className="min-h-[60px] text-sm"
                />
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPanel('actions')} disabled={acting} className="flex-1">Back</Button>
                  <Button size="sm" onClick={handleRequestInfo} disabled={acting || infoMessage.trim().length < 5} className="flex-1">
                    Send message
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {isApproved && (
        <p className="text-[11px] text-muted-foreground text-center bg-background/40 rounded-lg py-2">
          Crediting buyer as Sociva Balance (instant).
        </p>
      )}
      {isCompleted && (
        <p className="text-[11px] text-success text-center bg-success/5 rounded-lg py-2 font-medium">
          ₹{approvedAmount ?? cap} added to buyer Sociva Balance.
        </p>
      )}
    </motion.div>
  );
}
