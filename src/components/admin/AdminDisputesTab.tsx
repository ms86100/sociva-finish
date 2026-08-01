// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DisputeTicketCard } from '@/components/disputes/DisputeTicketCard';
import { DisputeDetailSheet } from '@/components/disputes/DisputeDetailSheet';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';

interface Ticket {
  id: string;
  category: string;
  description: string;
  status: string;
  is_anonymous: boolean;
  sla_deadline: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  submitted_by: string;
  submitter?: { name: string } | null;
}

export function AdminDisputesTab() {
  const { effectiveSocietyId } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Ticket | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!effectiveSocietyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('dispute_tickets')
      .select('*, submitter:profiles!dispute_tickets_submitted_by_fkey(name)')
      .eq('society_id', effectiveSocietyId)
      .order('created_at', { ascending: false });
    setTickets((data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
  const breachedCount = tickets.filter(t => t.status === 'submitted' && !t.acknowledged_at && new Date(t.sla_deadline) < new Date()).length;

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center">
          <AlertCircle size={15} className="text-rose-600" />
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-foreground">Disputes</h3>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="rounded-lg font-semibold text-[10px]">Open: {openCount}</Badge>
          {breachedCount > 0 && <Badge variant="destructive" className="rounded-lg text-[10px]">SLA Breached: {breachedCount}</Badge>}
          <Badge variant="secondary" className="rounded-lg text-[10px]">Total: {tickets.length}</Badge>
        </div>
      </div>

      {tickets.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-3">
            <ShieldCheck size={22} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No dispute tickets</p>
        </motion.div>
      ) : (
        tickets.map((ticket, idx) => (
          <motion.div key={ticket.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <DisputeTicketCard
              ticket={ticket}
              onClick={() => setSelected(ticket)}
              showSubmitter
            />
          </motion.div>
        ))
      )}

      <DisputeDetailSheet
        ticket={selected}
        open={!!selected}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        onUpdated={() => { fetchTickets(); setSelected(null); }}
        isAdmin
      />
    </div>
  );
}
