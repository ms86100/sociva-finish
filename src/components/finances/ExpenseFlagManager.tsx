// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Flag, CheckCircle, XCircle, Loader2, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useCurrency } from '@/hooks/useCurrency';

interface ExpenseFlag {
  id: string;
  reason: string;
  status: string;
  admin_response: string | null;
  resolved_at: string | null;
  created_at: string;
  expense: { id: string; title: string; amount: number; category: string } | null;
  flagger: { name: string; flat_number: string | null } | null;
}

export function ExpenseFlagManager() {
  const { user, effectiveSocietyId } = useAuth();
  const [flags, setFlags] = useState<ExpenseFlag[]>([]);
  const { formatPrice } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    if (!effectiveSocietyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('expense_flags')
      .select('*, expense:society_expenses!expense_flags_expense_id_fkey(id, title, amount, category), flagger:profiles!expense_flags_flagged_by_fkey(name, flat_number)')
      .eq('expense.society_id', effectiveSocietyId)
      .order('created_at', { ascending: false });
    setFlags((data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId]);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  const handleResolve = async (flagId: string, status: 'resolved' | 'dismissed') => {
    if (!user) return;
    setUpdating(flagId);
    const { error } = await supabase
      .from('expense_flags')
      .update({
        status,
        admin_response: responses[flagId]?.trim() || null,
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
      } as any)
      .eq('id', flagId);
    if (error) {
      toast.error('Failed to update flag');
    } else {
      toast.success(`Flag ${status}`);
      fetchFlags();
    }
    setUpdating(null);
  };

  if (loading) return <Skeleton className="h-24 w-full" />;

  const openFlags = flags.filter(f => f.status === 'pending');
  const closedFlags = flags.filter(f => f.status !== 'pending');

  if (flags.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Flag size={28} className="mx-auto mb-2" />
        <p className="text-sm">No expense flags</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {openFlags.length > 0 && (
        <p className="text-xs font-semibold text-destructive">Open Flags ({openFlags.length})</p>
      )}
      {openFlags.map(flag => (
        <Card key={flag.id} className="border-destructive/20">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium">{flag.expense?.title || 'Unknown Expense'}</p>
                <p className="text-xs text-muted-foreground">
                  {formatPrice(Number(flag.expense?.amount || 0))} · {flag.expense?.category}
                </p>
                <p className="text-xs mt-1">
                  <span className="text-muted-foreground">Flagged by:</span> {flag.flagger?.name} ({flag.flagger?.flat_number})
                </p>
              </div>
              <Badge variant="destructive" className="text-[9px]">Open</Badge>
            </div>
            <div className="bg-destructive/5 rounded-lg p-2">
              <p className="text-xs"><span className="font-medium">Concern:</span> {flag.reason}</p>
            </div>
            <Textarea
              value={responses[flag.id] || ''}
              onChange={e => setResponses(prev => ({ ...prev, [flag.id]: e.target.value }))}
              placeholder="Your response to the resident..."
              rows={2}
              className="text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => handleResolve(flag.id, 'dismissed')} disabled={updating === flag.id}>
                {updating === flag.id ? <Loader2 size={12} className="animate-spin mr-1" /> : <XCircle size={12} className="mr-1" />}
                Dismiss
              </Button>
              <Button size="sm" className="flex-1 text-xs" onClick={() => handleResolve(flag.id, 'resolved')} disabled={updating === flag.id}>
                {updating === flag.id ? <Loader2 size={12} className="animate-spin mr-1" /> : <CheckCircle size={12} className="mr-1" />}
                Resolve
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {closedFlags.length > 0 && (
        <>
          <p className="text-xs font-semibold text-muted-foreground mt-4">Resolved ({closedFlags.length})</p>
          {closedFlags.slice(0, 5).map(flag => (
            <Card key={flag.id} className="opacity-60">
              <CardContent className="p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">{flag.expense?.title}</p>
                    <p className="text-xs text-muted-foreground">{flag.reason}</p>
                    {flag.admin_response && (
                      <div className="mt-1 flex items-start gap-1">
                        <MessageCircle size={10} className="mt-0.5 text-primary" />
                        <p className="text-xs text-primary">{flag.admin_response}</p>
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[9px] capitalize">{flag.status}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
