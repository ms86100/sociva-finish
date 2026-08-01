// @ts-nocheck
import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { CreateDisputeSheet } from '@/components/disputes/CreateDisputeSheet';
import { DisputeTicketCard } from '@/components/disputes/DisputeTicketCard';
import { DisputeDetailSheet } from '@/components/disputes/DisputeDetailSheet';
import { Plus, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';

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

export default function DisputesPage() {
  const { user, isSocietyAdmin, isAdmin, effectiveSocietyId } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [tab, setTab] = useState('open');
  const [viewMode, setViewMode] = useState<'my' | 'all'>('my');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTickets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    let query = supabase
      .from('dispute_tickets')
      .select('*, submitter:profiles!dispute_tickets_submitted_by_fkey(name)')
      .order('created_at', { ascending: false });

    if (viewMode === 'my') {
      query = query.eq('submitted_by', user.id);
    } else if (effectiveSocietyId) {
      query = query.eq('society_id', effectiveSocietyId);
    }

    const { data } = await query;
    setTickets((data as any) || []);
    setLoading(false);
  }, [user, viewMode, effectiveSocietyId]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
  const closedTickets = tickets.filter(t => ['resolved', 'closed'].includes(t.status));

  const filterBySearch = (list: Ticket[]) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return list;
    return list.filter(t =>
      t.description.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q) ||
      t.status.toLowerCase().includes(q)
    );
  };

  const display = filterBySearch(tab === 'open' ? openTickets : closedTickets);

  return (
    <AppLayout headerTitle="My Concerns" showLocation={false}>
      <FeatureGate feature="disputes">
      <div className="p-4 space-y-4">
        {(isSocietyAdmin || isAdmin) && (
          <div className="flex gap-2">
            <Button size="sm" variant={viewMode === 'my' ? 'default' : 'outline'} onClick={() => setViewMode('my')} className="text-xs">My Concerns</Button>
            <Button size="sm" variant={viewMode === 'all' ? 'default' : 'outline'} onClick={() => setViewMode('all')} className="text-xs">All Society</Button>
          </div>
        )}
        <ModuleSearchBar context="disputes" value={searchQuery} onChange={setSearchQuery} />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="open" className="text-xs">Open ({openTickets.length})</TabsTrigger>
            <TabsTrigger value="closed" className="text-xs">Resolved ({closedTickets.length})</TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        ) : display.length === 0 ? (
          <div className="text-center py-12">
            <ShieldAlert size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {tab === 'open' ? 'No open concerns' : 'No resolved concerns yet'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">
              {tab === 'open'
                ? 'Use this to raise concerns about orders, payments, or community issues — privately to the committee'
                : 'Resolved concerns will appear here'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {display.map(ticket => (
              <DisputeTicketCard
                key={ticket.id}
                ticket={ticket}
                onClick={() => setSelectedTicket(ticket)}
              />
            ))}
          </div>
        )}
      </div>

      <Button
        size="icon"
        className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 w-12 h-12 rounded-full shadow-lg"
        onClick={() => setShowCreate(true)}
      >
        <Plus size={22} />
      </Button>

      <CreateDisputeSheet open={showCreate} onOpenChange={setShowCreate} onCreated={fetchTickets} />
      <DisputeDetailSheet
        ticket={selectedTicket}
        open={!!selectedTicket}
        onOpenChange={(open) => { if (!open) setSelectedTicket(null); }}
        onUpdated={() => { fetchTickets(); setSelectedTicket(null); }}
        isAdmin={viewMode === 'all' && (isSocietyAdmin || isAdmin)}
      />
      </FeatureGate>
    </AppLayout>
  );
}
