// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Bug, ShieldAlert, Clock, CheckCircle, AlertTriangle, ChevronRight, MessageSquare } from 'lucide-react';

interface SnagItem {
  id: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
  society_id: string;
  society_name?: string;
}

interface DisputeItem {
  id: string;
  description: string;
  category: string;
  status: string;
  created_at: string;
  sla_deadline: string;
  society_id: string;
  society_name?: string;
  submitted_by_name?: string;
}

interface BuilderActionCenterProps {
  societyIds: string[];
  onNavigateToSociety: (societyId: string, path: string) => void;
}

export function BuilderActionCenter({ societyIds, onNavigateToSociety }: BuilderActionCenterProps) {
  const [activeTab, setActiveTab] = useState('snags');
  const [statusFilter, setStatusFilter] = useState('open');

  const { data: snags = [], isLoading: snagsLoading } = useQuery({
    queryKey: ['builder-snags', societyIds, statusFilter],
    queryFn: async () => {
      if (societyIds.length === 0) return [];
      const openStatuses = ['reported', 'acknowledged', 'in_progress'];
      const allStatuses = ['reported', 'acknowledged', 'in_progress', 'fixed', 'verified', 'closed'];
      const statuses = statusFilter === 'open' ? openStatuses : allStatuses;

      const { data, error } = await supabase
        .from('snag_tickets')
        .select('id, description, category, status, created_at, society_id, tower_id, reported_by')
        .in('society_id', societyIds)
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) { console.error(error); return []; }

      // Enrich with society names
      const { data: societies } = await supabase
        .from('societies')
        .select('id, name')
        .in('id', societyIds);
      const societyMap = Object.fromEntries((societies || []).map(s => [s.id, s.name]));

      return (data || []).map(s => ({
        ...s,
        society_name: societyMap[s.society_id] || 'Unknown',
      })) as SnagItem[];
    },
    enabled: societyIds.length > 0,
  });

  const { data: disputes = [], isLoading: disputesLoading } = useQuery({
    queryKey: ['builder-disputes', societyIds, statusFilter],
    queryFn: async () => {
      if (societyIds.length === 0) return [];
      const openStatuses = ['open', 'acknowledged', 'in_progress'];
      const allStatuses = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'];
      const statuses = statusFilter === 'open' ? openStatuses : allStatuses;

      const { data, error } = await supabase
        .from('dispute_tickets')
        .select('id, description, category, status, created_at, sla_deadline, society_id, submitted_by')
        .in('society_id', societyIds)
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) { console.error(error); return []; }

      const { data: societies } = await supabase
        .from('societies')
        .select('id, name')
        .in('id', societyIds);
      const societyMap = Object.fromEntries((societies || []).map(s => [s.id, s.name]));

      return (data || []).map(d => ({
        ...d,
        society_name: societyMap[d.society_id] || 'Unknown',
      })) as DisputeItem[];
    },
    enabled: societyIds.length > 0,
  });

  const handleAcknowledge = async (table: 'snag_tickets' | 'dispute_tickets', id: string, societyId: string) => {
    const { error } = await supabase
      .from(table)
      .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString() })
      .eq('id', id)
      .eq('society_id', societyId);

    if (error) {
      toast.error('Failed to acknowledge');
    } else {
      toast.success('Acknowledged');
    }
  };

  const isSlaBreach = (deadline: string) => new Date(deadline) < new Date();
  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const openSnagCount = snags.filter(s => ['reported', 'acknowledged', 'in_progress'].includes(s.status)).length;
  const openDisputeCount = disputes.filter(d => ['open', 'acknowledged', 'in_progress'].includes(d.status)).length;

  if (societyIds.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            Action Center
          </h3>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-24 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary badges */}
        <div className="flex gap-2">
          <Badge variant={openSnagCount > 0 ? 'destructive' : 'secondary'} className="text-xs">
            <Bug size={12} className="mr-1" /> {openSnagCount} snags
          </Badge>
          <Badge variant={openDisputeCount > 0 ? 'destructive' : 'secondary'} className="text-xs">
            <ShieldAlert size={12} className="mr-1" /> {openDisputeCount} disputes
          </Badge>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="snags" className="text-xs">Snags ({snags.length})</TabsTrigger>
            <TabsTrigger value="disputes" className="text-xs">Disputes ({disputes.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="snags" className="mt-3 space-y-2 max-h-[400px] overflow-y-auto">
            {snagsLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : snags.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <CheckCircle className="mx-auto mb-2 text-success" size={24} />
                No open snags
              </div>
            ) : (
              snags.map(snag => (
                <Card key={snag.id} className="cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => onNavigateToSociety(snag.society_id, '/society/snags')}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{snag.description}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{snag.society_name}</Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">{snag.category}</Badge>
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock size={9} /> {timeAgo(snag.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {snag.status === 'reported' && (
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                            onClick={(e) => { e.stopPropagation(); handleAcknowledge('snag_tickets', snag.id, snag.society_id); }}>
                            Acknowledge
                          </Button>
                        )}
                        <Badge variant="secondary" className="text-[10px]">
                          {snag.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="disputes" className="mt-3 space-y-2 max-h-[400px] overflow-y-auto">
            {disputesLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : disputes.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <CheckCircle className="mx-auto mb-2 text-success" size={24} />
                No open disputes
              </div>
            ) : (
              disputes.map(dispute => (
                <Card key={dispute.id} className="cursor-pointer hover:shadow-sm transition-shadow"
                  onClick={() => onNavigateToSociety(dispute.society_id, '/disputes')}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{dispute.description}</p>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{dispute.society_name}</Badge>
                          <Badge variant="outline" className="text-[10px] capitalize">{dispute.category}</Badge>
                          {isSlaBreach(dispute.sla_deadline) && dispute.status !== 'resolved' && dispute.status !== 'closed' && (
                            <Badge variant="destructive" className="text-[10px]">SLA Breached</Badge>
                          )}
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <Clock size={9} /> {timeAgo(dispute.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {dispute.status === 'open' && (
                          <Button size="sm" variant="outline" className="h-6 text-[10px] px-2"
                            onClick={(e) => { e.stopPropagation(); handleAcknowledge('dispute_tickets', dispute.id, dispute.society_id); }}>
                            Acknowledge
                          </Button>
                        )}
                        <Badge variant={isSlaBreach(dispute.sla_deadline) ? 'destructive' : 'secondary'} className="text-[10px]">
                          {dispute.status}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
