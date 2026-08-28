import { FormEvent, useState } from 'react';
import { format } from 'date-fns';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FinancialAdjustmentRequest } from '@/lib/financial-controls';
import { useFinancialAdjustmentMutations } from '@/hooks/useFinancialControls';
import { supabase } from '@/integrations/supabase/client';

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

function AdjustmentRow({
  request,
  currentUserId,
  onApprove,
  onReject,
  onCancel,
  busy,
}: {
  request: FinancialAdjustmentRequest;
  currentUserId?: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onCancel: (id: string) => void;
  busy: boolean;
}) {
  const isMaker = currentUserId === request.requested_by;
  const canApprove = request.status === 'pending' && !isMaker;
  const canCancel = request.status === 'pending' && isMaker;
  const rejection =
    typeof request.metadata?.rejection_reason === 'string'
      ? request.metadata.rejection_reason
      : null;

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">
              {request.reference_type} · {request.reference_id}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {request.requester_name || request.requested_by.slice(0, 8)}
            </p>
          </div>
          <Badge variant={request.status === 'posted' ? 'default' : 'outline'}>
            {request.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{request.reason}</p>
        <pre className="overflow-x-auto rounded-lg bg-muted p-2 text-[10px] leading-relaxed">
          {JSON.stringify(request.entries, null, 2)}
        </pre>
        {request.journal_transaction_id && (
          <p className="text-[10px] text-muted-foreground">
            Journal {String(request.journal_transaction_id).slice(0, 8)}…
          </p>
        )}
        {rejection && (
          <p className="text-[11px] text-destructive">Rejected: {rejection}</p>
        )}
        <p className="text-[10px] text-muted-foreground">
          {format(new Date(request.requested_at), 'MMM d, yyyy HH:mm')}
        </p>
        {request.status === 'pending' && (
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <>
                <Button size="sm" onClick={() => onApprove(request.id)} disabled={busy}>
                  <Check size={14} className="mr-1" />
                  Approve & post
                </Button>
                <Button size="sm" variant="outline" onClick={() => onReject(request.id)} disabled={busy}>
                  <X size={14} className="mr-1" />
                  Reject
                </Button>
              </>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" onClick={() => onCancel(request.id)} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FinancialAdjustmentsPanel({
  pending,
  recent,
  currentUserId,
  onSubmitted,
}: {
  pending: FinancialAdjustmentRequest[];
  recent: FinancialAdjustmentRequest[];
  currentUserId?: string;
  onSubmitted?: () => void;
}) {
  const mutations = useFinancialAdjustmentMutations();
  const [referenceType, setReferenceType] = useState('order');
  const [referenceId, setReferenceId] = useState('');
  const [reason, setReason] = useState('');
  const [debitAccount, setDebitAccount] = useState('');
  const [creditAccount, setCreditAccount] = useState('');
  const [amountMinor, setAmountMinor] = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const accounts = useQuery({
    queryKey: ['admin-ledger-account-codes'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_ledger_account_codes');
      if (error) throw new Error(error.message);
      return Array.isArray(data) ? (data as { code: string; name: string }[]) : [];
    },
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(amountMinor);
    if (!referenceId.trim()) return toast.error('Reference id is required');
    if (reason.trim().length < 20) return toast.error('Reason must be at least 20 characters');
    if (!debitAccount || !creditAccount) return toast.error('Select debit and credit accounts');
    if (!Number.isInteger(amount) || amount <= 0) {
      return toast.error('Amount must be a positive whole number of paise (minor units)');
    }
    const entries = [
      { account_code: debitAccount, direction: 'debit', amount_minor: amount },
      { account_code: creditAccount, direction: 'credit', amount_minor: amount },
    ];
    try {
      await mutations.request.mutateAsync({
        referenceType: referenceType.trim(),
        referenceId: referenceId.trim(),
        entries,
        reason: reason.trim(),
      });
      toast.success('Adjustment requested — a different admin must approve');
      setReferenceId('');
      setReason('');
      setAmountMinor('');
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not request adjustment');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await mutations.approve.mutateAsync(id);
      toast.success('Adjustment posted to ledger');
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      await mutations.reject.mutateAsync({
        requestId: rejectId,
        reason: rejectReason.trim() || undefined,
      });
      toast.success('Adjustment rejected');
      setRejectId(null);
      setRejectReason('');
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reject failed');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await mutations.cancel.mutateAsync(id);
      toast.success('Request cancelled');
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Cancel failed');
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Request balanced ledger adjustment</h3>
          <p className="text-xs text-muted-foreground">
            Posts a reversing or corrective journal after checker approval. Use Financial trace to find the reference first.
          </p>
          <form onSubmit={submit} className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={referenceType}
                onChange={(e) => setReferenceType(e.target.value)}
                placeholder="Reference type (e.g. order)"
              />
              <Input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                placeholder="Reference id"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={debitAccount} onValueChange={setDebitAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Debit account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data || []).map((a) => (
                    <SelectItem key={`d-${a.code}`} value={a.code}>
                      {a.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={creditAccount} onValueChange={setCreditAccount}>
                <SelectTrigger>
                  <SelectValue placeholder="Credit account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts.data || []).map((a) => (
                    <SelectItem key={`c-${a.code}`} value={a.code}>
                      {a.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              type="number"
              min="1"
              step="1"
              value={amountMinor}
              onChange={(e) => setAmountMinor(e.target.value)}
              placeholder="Amount in paise (minor units)"
            />
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Detailed reason (min 20 characters)"
              rows={3}
            />
            <Button type="submit" disabled={mutations.busy}>
              Submit for approval
            </Button>
          </form>
        </CardContent>
      </Card>

      {pending.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Pending adjustments ({pending.length})</h3>
          {pending.map((req) => (
            <AdjustmentRow
              key={req.id}
              request={req}
              currentUserId={currentUserId}
              onApprove={handleApprove}
              onReject={(id) => setRejectId(id)}
              onCancel={handleCancel}
              busy={mutations.busy}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent adjustments</h3>
          {recent.map((req) => (
            <AdjustmentRow
              key={req.id}
              request={req}
              currentUserId={currentUserId}
              onApprove={() => {}}
              onReject={() => {}}
              onCancel={() => {}}
              busy={mutations.busy}
            />
          ))}
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md">
            <CardContent className="p-4 space-y-3">
              <h4 className="font-semibold">Reject adjustment</h4>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Optional rejection note"
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRejectId(null)}>
                  Cancel
                </Button>
                <Button onClick={handleReject} disabled={mutations.busy}>
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
