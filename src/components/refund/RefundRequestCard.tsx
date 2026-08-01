// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, XCircle, CreditCard } from 'lucide-react';
import { motion } from 'framer-motion';
import { cardEntrance } from '@/lib/motion-variants';
import { MultiImageCapture } from '@/components/ui/multi-image-capture';
import { RefundTimeline } from './RefundTimeline';
import { notify } from '@/lib/notify';

interface RefundRequestCardProps {
  orderId: string;
  orderStatus: string;
  paymentStatus: string;
  isBuyerView: boolean;
  totalAmount: number;
  onRefundRequested?: () => void;
}

interface RefundRequest {
  id: string;
  status: string;
  refund_state: string;
  amount: number;
  reason: string;
  category: string;
  auto_approved: boolean;
  created_at: string;
  approved_at: string | null;
  settled_at: string | null;
  rejection_reason: string | null;
  gateway_refund_id: string | null;
  refund_method: string;
  evidence_urls: string[] | null;
}

const REFUND_CATEGORIES = [
  { value: 'order_issue', label: 'Order Issue' },
  { value: 'quality_issue', label: 'Quality Problem' },
  { value: 'wrong_item', label: 'Wrong Item Received' },
  { value: 'not_received', label: 'Not Received' },
  { value: 'seller_cancelled', label: 'Seller Cancelled' },
  { value: 'other', label: 'Other' },
] as const;

const VALID_REFUND_CATEGORIES = new Set(REFUND_CATEGORIES.map((item) => item.value));

export function RefundRequestCard({ orderId, orderStatus, paymentStatus, isBuyerView, totalAmount, onRefundRequested }: RefundRequestCardProps) {
  const { user } = useAuth();
  const [existingRefund, setExistingRefund] = useState<RefundRequest | null>(null);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reason, setReason] = useState('');
  const [category, setCategory] = useState('order_issue');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const canRequestRefund = isBuyerView &&
    ['paid', 'buyer_confirmed', 'seller_verified', 'completed'].includes(paymentStatus) &&
    ['delivered', 'completed', 'cancelled', 'failed', 'buyer_received'].includes(orderStatus);

  async function fetchRefund() {
    const { data } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const refund = data[0] as RefundRequest;
      setExistingRefund(refund);
      // Fetch audit log
      const { data: audit } = await supabase
        .from('refund_audit_log')
        .select('*')
        .eq('refund_id', refund.id)
        .order('created_at', { ascending: true });
      setAuditLog(audit || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchRefund();

    // Realtime subscription on refund_requests for this order
    const channel = supabase
      .channel(`refund-${orderId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'refund_requests', filter: `order_id=eq.${orderId}` },
        (payload: any) => {
          console.info('[Refund] realtime update', payload.eventType, payload.new?.refund_state);
          fetchRefund();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'refund_audit_log' },
        (payload: any) => {
          if (existingRefund && payload.new?.refund_id === existingRefund.id) {
            fetchRefund();
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function handleSubmit() {
    if (!VALID_REFUND_CATEGORIES.has(category)) {
      notify.block('Please select a valid refund category');
      return;
    }
    if (!reason.trim() || reason.trim().length < 10) {
      notify.block('Please provide a detailed reason (at least 10 characters)');
      return;
    }

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('request_refund', {
        p_order_id: orderId,
        p_reason: reason.trim(),
        p_category: category,
        p_evidence_urls: evidenceUrls,
      } as any);

      if (error) throw error;
      toast.success('Refund request submitted');
      setShowForm(false);
      setReason('');
      setEvidenceUrls([]);
      await fetchRefund();
      onRefundRequested?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit refund request');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  // Show existing refund status
  if (existingRefund) {
    const state = existingRefund.refund_state || existingRefund.status;
    const isInFlight = ['approved', 'refund_initiated', 'refund_processing'].includes(state);
    const isCompleted = state === 'refund_completed';
    const isRejected = state === 'rejected';

    return (
      <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <p className="text-sm font-semibold">Refund</p>
          </div>
          <p className="text-sm font-bold">₹{existingRefund.amount}</p>
        </div>

        <RefundTimeline currentState={state} auditLog={auditLog} />

        {(isInFlight || isCompleted) && (
          <div className="flex items-start gap-2 bg-primary/5 border border-primary/10 rounded-lg px-3 py-2">
            <CreditCard size={14} className="text-primary shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[11px] font-medium">
                {isCompleted ? 'Refunded to your original payment method' : 'Returning to your original payment method'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {isCompleted
                  ? 'Funds typically reflect in 3–5 business days depending on your bank.'
                  : 'Auto-settled within 3–5 business days. No action needed.'}
              </p>
              {existingRefund.gateway_refund_id && (
                <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                  Ref: {existingRefund.gateway_refund_id}
                </p>
              )}
            </div>
          </div>
        )}

        {isRejected && existingRefund.rejection_reason && (
          <div className="p-2 bg-destructive/5 rounded-lg">
            <p className="text-[11px] text-destructive font-medium">
              Rejected: {existingRefund.rejection_reason}
            </p>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">"{existingRefund.reason}"</p>
      </motion.div>
    );
  }

  if (!canRequestRefund) return null;

  if (!showForm) {
    return (
      <motion.div variants={cardEntrance} className="bg-destructive/5 border border-destructive/20 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="text-destructive" size={18} />
          <div>
            <p className="text-sm font-semibold">Issue with order?</p>
            <p className="text-[11px] text-muted-foreground">Request a refund</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="border-destructive/30 text-destructive hover:bg-destructive/10">
          Request Refund
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div variants={cardEntrance} className="bg-card/80 backdrop-blur-lg border border-border/50 rounded-xl px-4 py-3 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-primary" />
        <p className="text-sm font-semibold">Request Refund</p>
      </div>

      <div className="p-2.5 bg-muted/50 rounded-lg">
        <p className="text-xs text-muted-foreground">Refund amount</p>
        <p className="text-lg font-bold">₹{totalAmount}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">Returned to your original payment method (3–5 business days)</p>
      </div>

      <Select value={category} onValueChange={setCategory}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder="Select reason category" />
        </SelectTrigger>
        <SelectContent>
          {REFUND_CATEGORIES.map(c => (
            <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Textarea
        placeholder="Describe the issue in detail (min 10 characters)..."
        value={reason}
        onChange={e => setReason(e.target.value)}
        className="min-h-[80px] text-sm"
      />

      <div>
        <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Add photos (optional)</p>
        <MultiImageCapture value={evidenceUrls} onChange={setEvidenceUrls} pathPrefix="refund-evidence" max={3} />
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="flex-1">Cancel</Button>
        <Button size="sm" onClick={handleSubmit} disabled={submitting || reason.trim().length < 10} className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90">
          {submitting ? <><Loader2 size={14} className="animate-spin mr-1" /> Submitting...</> : 'Submit Request'}
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Seller has 48 hours to respond. Auto-approved after deadline.
      </p>
    </motion.div>
  );
}
