// @ts-nocheck
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

export function AdminCleanerCityTab() {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [societyId, setSocietyId] = useState('');
  const [matchScope, setMatchScope] = useState('neighbours');

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['cleaner-city-admin-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cleaner_city_admin_stats');
      if (error) throw error;
      return data as Record<string, number | null>;
    },
    retry: 1,
  });

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['cleaner-city-admin-domains'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_domains')
        .select('id, domain, company_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['cleaner-city-admin-incidents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_incidents')
        .select('id, ride_id, incident_type, severity, status, note, created_at')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const upsertDomain = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cleaner_city_admin_upsert_company_domain', {
        p_domain: domain.trim().toLowerCase(),
        p_company_name: companyName.trim(),
        p_status: 'approved',
        p_notes: 'Admin approved',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Domain approved');
      setDomain('');
      setCompanyName('');
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-domains'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save domain'),
  });

  const resolveIncident = useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase.rpc('cleaner_city_admin_resolve_incident', {
        p_incident_id: input.id,
        p_status: input.status,
        p_admin_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Incident updated');
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Resolve failed'),
  });

  const setScope = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cleaner_city_admin_set_match_scope', {
        p_society_id: societyId.trim(),
        p_match_scope: matchScope,
        p_thresholds: null,
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success('Match scope updated'),
    onError: (e: any) => toast.error(e?.message || 'Scope update failed'),
  });

  return (
    <div className="space-y-4" data-testid="admin-cleaner-city-tab">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">A Cleaner City</h2>
        <Badge variant="secondary">Ops</Badge>
      </div>
      <p className="text-sm text-muted-foreground max-w-2xl">
        Domains, safety incidents, match scope, and pilot metrics. Fuel settlement stays legal-gated.
      </p>

      {statsLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Profiles', stats.profiles],
            ['Verified', stats.verified],
            ['Vehicles', stats.active_vehicles],
            ['Open pubs', stats.publications_open],
            ['Rides today', stats.rides_today],
            ['Active rides', stats.rides_active],
            ['Open incidents', stats.incidents_open],
            ['Avg rating', stats.avg_rating],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border p-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value ?? 0}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Approve company domain</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="company.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <Input
            placeholder="Company name"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <Button
            onClick={() => upsertDomain.mutate()}
            disabled={upsertDomain.isPending || !domain.trim() || !companyName.trim()}
          >
            Approve domain
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Domains</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
          {!isLoading && domains.length === 0 && (
            <p className="text-xs text-muted-foreground">No domains yet</p>
          )}
          {domains.map((row: any) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-2 text-sm border-b border-border py-2"
            >
              <div>
                <p className="font-medium">{row.domain}</p>
                <p className="text-xs text-muted-foreground">{row.company_name}</p>
              </div>
              <Badge variant={row.status === 'approved' ? 'default' : 'secondary'}>
                {row.status}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Open safety incidents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {incidents.length === 0 && (
            <p className="text-xs text-muted-foreground">No open incidents</p>
          )}
          {incidents.map((inc: any) => (
            <div key={inc.id} className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-sm font-semibold">
                {inc.incident_type} · {inc.severity}
              </p>
              <p className="text-xs text-muted-foreground">
                Ride {String(inc.ride_id).slice(0, 8)}… · {inc.note || 'No note'}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveIncident.mutate({ id: inc.id, status: 'acknowledged' })}
                >
                  Ack
                </Button>
                <Button
                  size="sm"
                  onClick={() => resolveIncident.mutate({ id: inc.id, status: 'resolved' })}
                >
                  Resolve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolveIncident.mutate({ id: inc.id, status: 'dismissed' })}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Match scope (pilot)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Society UUID"
            value={societyId}
            onChange={(e) => setSocietyId(e.target.value)}
          />
          <select
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={matchScope}
            onChange={(e) => setMatchScope(e.target.value)}
          >
            <option value="same_society">Same society</option>
            <option value="neighbours">Neighbours</option>
            <option value="city">City</option>
          </select>
          <Button
            variant="outline"
            onClick={() => setScope.mutate()}
            disabled={!societyId.trim() || setScope.isPending}
          >
            Save match scope
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
