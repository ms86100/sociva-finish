// @ts-nocheck
import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { toast } from 'sonner';
import { format } from 'date-fns';

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export default function AdminSellerPayoutsPage() {
  const { formatPrice } = useCurrency();
  const qc = useQueryClient();
  const [sellerId, setSellerId] = useState('');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [transferRef, setTransferRef] = useState('');
  const [transferredAt, setTransferredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [withdrawalId, setWithdrawalId] = useState('');
  const [saving, setSaving] = useState(false);

  const withdrawals = useQuery({
    queryKey: ['admin-withdrawal-console'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_withdrawals', { p_limit: 80 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  });
  const eligible = useQuery({
    queryKey: ['admin-eligible-settlements', sellerId],
    queryFn: async () => {
      if (!sellerId) return [];
      const { data, error } = await adminRpc('admin_list_eligible_settlements', { p_seller_id: sellerId });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: Boolean(sellerId),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!sellerId.trim()) return toast.error('Seller id is required');
    if (!destination.trim()) return toast.error('Destination is required');
    if (!transferRef.trim()) return toast.error('UTR / transfer reference is required before marking paid');
    if (!notes.trim()) return toast.error('Admin notes are required');
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error('Amount must be greater than zero');
    setSaving(true);
    try {
      const { error } = await adminRpc('admin_record_offline_seller_transfer', {
        p_seller_id: sellerId.trim(),
        p_amount: value,
        p_destination: destination.trim(),
        p_transfer_ref: transferRef.trim(),
        p_transferred_at: transferredAt || new Date().toISOString(),
        p_admin_notes: notes.trim(),
        p_withdrawal_id: withdrawalId.trim() || null,
      });
      if (error) throw error;
      toast.success('Transfer recorded. Seller will be notified with the UTR and updated balance.');
      setAmount('');
      setTransferRef('');
      setNotes('');
      qc.invalidateQueries({ queryKey: ['admin-withdrawal-console'] });
      qc.invalidateQueries({ queryKey: ['admin-eligible-settlements'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record transfer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Seller payouts</h1>
            <p className="text-xs text-muted-foreground">Offline UPI/bank transfers require a UTR before anything is marked paid</p>
          </div>
        </div>
      </SafeHeader>
      <div className="p-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold">Record offline transfer</h2>
            <form onSubmit={submit} className="space-y-2">
              <Input value={sellerId} onChange={(e) => setSellerId(e.target.value)} placeholder="Seller id" />
              <Input value={withdrawalId} onChange={(e) => setWithdrawalId(e.target.value)} placeholder="Withdrawal request id (optional)" />
              <Input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
              <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Destination (UPI / bank details)" />
              <Input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} placeholder="UTR / transfer reference" required />
              <Input type="datetime-local" value={transferredAt} onChange={(e) => setTransferredAt(e.target.value)} />
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Admin notes (required)" />
              <Button type="submit" disabled={saving || !transferRef.trim()}>Record transferred</Button>
            </form>
          </CardContent>
        </Card>

        {sellerId && (
          <div>
            <h3 className="font-semibold mb-2">Eligible settlements</h3>
            {(eligible.data || []).map((row: any) => (
              <Card key={row.id} className="mb-2">
                <CardContent className="p-3 flex justify-between text-sm">
                  <span>#{String(row.id).slice(0, 8)} · {row.settlement_status}</span>
                  <span className="tabular-nums">{formatPrice(Number(row.net_amount) || 0)}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-2">Withdrawal requests</h3>
          {(withdrawals.data || []).map((row: any) => (
            <Card key={row.id} className="mb-2">
              <CardContent className="p-3 space-y-1">
                <div className="flex justify-between gap-2">
                  <p className="text-sm font-medium">{row.seller_name || row.seller_id}</p>
                  <Badge variant="outline">{row.status}</Badge>
                </div>
                <p className="text-sm tabular-nums">{formatPrice(Number(row.amount) || 0)}</p>
                {row.transfer_ref && <p className="text-[11px] text-muted-foreground">UTR {row.transfer_ref}</p>}
                {row.created_at && (
                  <p className="text-[11px] text-muted-foreground">{format(new Date(row.created_at), 'MMM d, yyyy')}</p>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSellerId(row.seller_id || '');
                    setWithdrawalId(row.id);
                    setAmount(String(row.amount || ''));
                  }}
                >
                  Use in form
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}
