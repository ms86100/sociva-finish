// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2, Mic, Phone, Store } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { SOCIVA_VOICE_LEAD_STATUSES, type SocivaVoiceLeadStatus } from '@/lib/sociva-voice-lead';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<SocivaVoiceLeadStatus, string> = {
  new: 'New',
  in_review: 'In review',
  store_setup: 'Store setup',
  closed: 'Closed',
};

function statusBadge(status: string) {
  const label = STATUS_LABEL[status] || status;
  if (status === 'new') return <Badge className="rounded-md text-[10px]">{label}</Badge>;
  if (status === 'in_review') return <Badge variant="outline" className="rounded-md text-[10px]">{label}</Badge>;
  if (status === 'store_setup') return <Badge variant="secondary" className="rounded-md text-[10px]">{label}</Badge>;
  return <Badge variant="outline" className="rounded-md text-[10px] text-muted-foreground">{label}</Badge>;
}

export default function AdminSellerInterestPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const leadsQuery = useQuery({
    queryKey: ['seller-interest-leads'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_interest_leads')
        .select('id, created_at, full_name, phone, society_name, retell_call_id, status, admin_notes, linked_seller_profile_id')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const selected = useMemo(
    () => (leadsQuery.data || []).find((row) => row.id === selectedId) || (leadsQuery.data || [])[0] || null,
    [leadsQuery.data, selectedId],
  );

  const callQuery = useQuery({
    queryKey: ['sociva-voice-call', selected?.id, selected?.retell_call_id],
    enabled: Boolean(selected?.retell_call_id),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-sociva-voice-call', {
        body: { lead_id: selected.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Could not load call');
      return data.call;
    },
  });

  const updateLead = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      if (!selected?.id) return;
      const { error } = await supabase.from('seller_interest_leads').update(patch).eq('id', selected.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['seller-interest-leads'] }),
  });

  return (
    <AppLayout headerTitle="Seller interest" showLocation={false} showNav={false} showCart={false} showBack>
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Talk to Sociva leads</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Contact details live in Sociva. Conversation history is loaded live from Retell.
          </p>
        </div>

        {leadsQuery.isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (leadsQuery.data || []).length === 0 ? (
          <Card className="rounded-2xl border-0 shadow-[var(--shadow-card)]">
            <CardContent className="p-6 text-sm text-muted-foreground">
              No voice leads yet. Share /talk-to-sociva with sellers.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
            <div className="space-y-2">
              {(leadsQuery.data || []).map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(lead.id);
                    setNotes(lead.admin_notes || '');
                  }}
                  className={cn(
                    'w-full text-left rounded-2xl border p-3 transition-colors',
                    selected?.id === lead.id ? 'border-primary bg-primary/5' : 'border-border bg-card',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{lead.full_name}</p>
                    {statusBadge(lead.status)}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">{lead.society_name}</p>
                  <p className="text-[11px] text-muted-foreground">{format(new Date(lead.created_at), 'dd MMM, h:mm a')}</p>
                </button>
              ))}
            </div>

            {selected && (
              <Card className="rounded-2xl border-0 shadow-[var(--shadow-card)]">
                <CardContent className="p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold">{selected.full_name}</h2>
                      <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Phone size={13} /> {selected.phone}
                      </p>
                      <p className="text-sm text-muted-foreground">{selected.society_name}</p>
                    </div>
                    <Select
                      value={selected.status}
                      onValueChange={(value) => updateLead.mutate({ status: value })}
                    >
                      <SelectTrigger className="w-40 h-9 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOCIVA_VOICE_LEAD_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>{STATUS_LABEL[status]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" className="rounded-xl">
                      <Link to="/admin/stores">
                        <Store size={14} className="mr-1.5" /> Set up store
                      </Link>
                    </Button>
                    {selected.linked_seller_profile_id && (
                      <Button asChild size="sm" variant="outline" className="rounded-xl">
                        <Link to={`/admin/stores/${selected.linked_seller_profile_id}`}>Open linked store</Link>
                      </Button>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold mb-1.5">Admin notes</p>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="rounded-xl min-h-[80px]"
                      placeholder="What the team needs to set up..."
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 rounded-xl"
                      disabled={updateLead.isPending}
                      onClick={() => updateLead.mutate({ admin_notes: notes })}
                    >
                      Save notes
                    </Button>
                  </div>

                  <div className="rounded-xl bg-muted/50 p-3">
                    <p className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                      <Mic size={13} /> Conversation from Retell
                    </p>
                    {!selected.retell_call_id ? (
                      <p className="text-sm text-muted-foreground">No voice call was connected for this lead.</p>
                    ) : callQuery.isLoading ? (
                      <Loader2 className="animate-spin text-muted-foreground" size={18} />
                    ) : callQuery.isError ? (
                      <p className="text-sm text-destructive">{(callQuery.error as Error).message}</p>
                    ) : (
                      <div className="space-y-3 text-sm">
                        {callQuery.data?.call_summary && (
                          <p><span className="font-medium">Summary:</span> {callQuery.data.call_summary}</p>
                        )}
                        {callQuery.data?.duration_ms != null && (
                          <p className="text-muted-foreground">
                            Duration {Math.round(Number(callQuery.data.duration_ms) / 1000)}s
                            {callQuery.data.call_status ? ` - ${callQuery.data.call_status}` : ''}
                          </p>
                        )}
                        {callQuery.data?.recording_url && (
                          <audio controls className="w-full" src={callQuery.data.recording_url} />
                        )}
                        {callQuery.data?.transcript && (
                          <pre className="whitespace-pre-wrap text-xs bg-background rounded-lg p-3 max-h-72 overflow-y-auto">
                            {typeof callQuery.data.transcript === 'string'
                              ? callQuery.data.transcript
                              : JSON.stringify(callQuery.data.transcript, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
