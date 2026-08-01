// @ts-nocheck
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { SnagTicketCard } from '@/components/snags/SnagTicketCard';
import { CreateSnagSheet } from '@/components/snags/CreateSnagSheet';
import { SnagDetailSheet } from '@/components/snags/SnagDetailSheet';
import { Wrench, Users, AlertTriangle } from 'lucide-react';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';
interface SnagTicket {
  id: string;
  flat_number: string;
  category: string;
  description: string;
  photo_urls: string[];
  status: string;
  sla_deadline: string;
  assigned_to_name: string | null;
  acknowledged_at: string | null;
  fixed_at: string | null;
  verified_at: string | null;
  resolution_note: string | null;
  created_at: string;
  reported_by: string;
  society_id: string;
  tower_id: string | null;
}

interface CollectiveEscalation {
  id: string;
  category: string;
  snag_count: number;
  resident_count: number;
  sample_photos: string[];
  status: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  plumbing: 'Plumbing', electrical: 'Electrical', civil: 'Civil', painting: 'Painting',
  carpentry: 'Carpentry', lift: 'Lift', common_area: 'Common Area', other: 'Other',
};

export default function SnagListPage() {
  const { effectiveSocietyId } = useAuth();
  const [tickets, setTickets] = useState<SnagTicket[]>([]);
  const [escalations, setEscalations] = useState<CollectiveEscalation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<SnagTicket | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTickets = async () => {
    if (!effectiveSocietyId) return;
    const [ticketRes, escalationRes] = await Promise.all([
      supabase.from('snag_tickets').select('*').eq('society_id', effectiveSocietyId).order('created_at', { ascending: false }),
      supabase.from('collective_escalations').select('*').eq('society_id', effectiveSocietyId).eq('status', 'active'),
    ]);

    setTickets((ticketRes.data as any) || []);
    setEscalations((escalationRes.data as any) || []);
    setIsLoading(false);
  };

  useEffect(() => { fetchTickets(); }, [effectiveSocietyId]);

  if (isLoading) {
    return (
      <AppLayout headerTitle="Snag Reports" showLocation={false}>
        <div className="p-4 space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Snag Reports" showLocation={false}>
      <FeatureGate feature="snag_management">
      <div className="p-4 space-y-4">
        <ModuleSearchBar context="construction" value={searchQuery} onChange={setSearchQuery} />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wrench size={18} className="text-primary" />
            <h2 className="font-semibold text-sm">Defect Reports</h2>
          </div>
          <CreateSnagSheet onCreated={fetchTickets} />
        </div>

        {/* Collective Escalations */}
        {escalations.length > 0 && (
          <div className="space-y-2">
            {escalations.map((esc) => (
              <Card key={esc.id} className="border-destructive/30 bg-destructive/5">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                    <Users size={16} className="text-destructive" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle size={12} className="text-destructive" />
                      <p className="text-xs font-bold text-destructive">Collective Issue</p>
                    </div>
                    <p className="text-sm font-semibold">{CATEGORY_LABELS[esc.category] || esc.category}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {esc.resident_count} residents reported {esc.snag_count} snags
                    </p>
                  </div>
                  <Badge variant="destructive" className="text-[9px] shrink-0">{esc.snag_count}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tickets.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Wrench className="mx-auto mb-3" size={32} />
            <p className="text-sm">No snag reports yet</p>
            <p className="text-xs mt-1">Report any defects found in your flat</p>
          </div>
        ) : (
          <div className="space-y-3">
            {tickets
              .filter(t => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return t.description.toLowerCase().includes(q) ||
                  t.category.toLowerCase().includes(q) ||
                  t.flat_number.toLowerCase().includes(q) ||
                  t.status.toLowerCase().includes(q);
              })
              .map((t) => (
                <SnagTicketCard key={t.id} ticket={t} onClick={() => setSelectedTicket(t)} />
              ))}
          </div>
        )}

        <SnagDetailSheet
          ticket={selectedTicket}
          open={!!selectedTicket}
          onOpenChange={(v) => !v && setSelectedTicket(null)}
          onUpdated={() => { fetchTickets(); setSelectedTicket(null); }}
        />
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
