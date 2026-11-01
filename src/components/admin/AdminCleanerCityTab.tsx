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
  const [meetupSociety, setMeetupSociety] = useState('');
  const [meetupLabel, setMeetupLabel] = useState('');
  const [meetupLat, setMeetupLat] = useState('');
  const [meetupLng, setMeetupLng] = useState('');
  const [meetupKind, setMeetupKind] = useState('gate');

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

  const { data: pendingDocs = [] } = useQuery({
    queryKey: ['cleaner-city-admin-vehicle-docs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_documents')
        .select('id, document_type, label, status, storage_path, created_at')
        .eq('status', 'uploaded')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const { data: openDisputes = [] } = useQuery({
    queryKey: ['cleaner-city-admin-disputes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ride_dispute_cases')
        .select('id, ride_id, status, note, appeal_note, prior_status, created_at')
        .in('status', ['open', 'appealed'])
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const reviewDoc = useMutation({
    mutationFn: async (input: { id: string; status: 'verified' | 'rejected' }) => {
      const { error } = await supabase.rpc('cleaner_city_admin_review_vehicle_document', {
        p_document_id: input.id,
        p_status: input.status,
        p_note: input.status === 'verified' ? 'Approved' : 'Rejected',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Document reviewed');
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-vehicle-docs'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not review document'),
  });

  const resolveDispute = useMutation({
    mutationFn: async (input: { ride_id: string; outcome: 'upheld' | 'dismissed' }) => {
      const { error } = await supabase.rpc('cleaner_city_admin_resolve_dispute', {
        p_ride_id: input.ride_id,
        p_outcome: input.outcome,
        p_note: input.outcome === 'upheld' ? 'Dispute upheld' : 'Dispute dismissed',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Dispute resolved');
      queryClient.invalidateQueries({ queryKey: ['cleaner-city-admin-disputes'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Could not resolve dispute'),
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

  const saveMeetup = useMutation({
    mutationFn: async () => {
      const lat = Number(meetupLat);
      const lng = Number(meetupLng);
      const { error } = await supabase.rpc('cleaner_city_admin_upsert_meetup_point', {
        p_society_id: meetupSociety.trim(),
        p_label: meetupLabel.trim(),
        p_latitude: lat,
        p_longitude: lng,
        p_kind: meetupKind,
        p_point_id: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Meetup point saved');
      setMeetupLabel('');
      setMeetupLat('');
      setMeetupLng('');
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save meetup point'),
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
        Domains, safety incidents, match scope, and pilot metrics. Fuel paid by a guest is recorded as payable to the host.
      </p>

      <Card data-testid="admin-cleaner-city-meetup-points-note">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Society meetup points</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Meetup points (gate, clubhouse, main road, parking) appear on the ride page after an
            admin saves the real latitude and longitude here. Sociva does not invent society coordinates.
          </p>
          <Input placeholder="Society UUID" value={meetupSociety} onChange={(e) => setMeetupSociety(e.target.value)} />
          <Input placeholder="Label, for example Clubhouse gate" value={meetupLabel} onChange={(e) => setMeetupLabel(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Latitude" value={meetupLat} onChange={(e) => setMeetupLat(e.target.value)} />
            <Input placeholder="Longitude" value={meetupLng} onChange={(e) => setMeetupLng(e.target.value)} />
          </div>
          <select
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            value={meetupKind}
            onChange={(e) => setMeetupKind(e.target.value)}
          >
            <option value="gate">Gate</option>
            <option value="clubhouse">Clubhouse</option>
            <option value="main_road">Main road</option>
            <option value="parking">Parking</option>
            <option value="other">Other</option>
          </select>
          <Button
            variant="outline"
            disabled={saveMeetup.isPending || !meetupSociety.trim() || !meetupLabel.trim()}
            onClick={() => saveMeetup.mutate()}
            data-testid="admin-cleaner-city-save-meetup"
          >
            Save meetup point
          </Button>
        </CardContent>
      </Card>

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

      <Card data-testid="admin-cleaner-city-vehicle-docs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Vehicle documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {pendingDocs.length === 0 && (
            <p className="text-xs text-muted-foreground">No documents waiting for review.</p>
          )}
          {pendingDocs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="capitalize">{doc.document_type}{doc.label ? ` · ${doc.label}` : ''}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => reviewDoc.mutate({ id: doc.id, status: 'verified' })}>
                  Verify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => reviewDoc.mutate({ id: doc.id, status: 'rejected' })}>
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card data-testid="admin-cleaner-city-disputes">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Commute disputes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {openDisputes.length === 0 && (
            <p className="text-xs text-muted-foreground">No open disputes.</p>
          )}
          {openDisputes.map((row) => (
            <div key={row.id} className="space-y-1 rounded-xl border border-border p-2 text-xs">
              <p>{row.status} · was {row.prior_status}</p>
              {row.note && <p className="text-muted-foreground">{row.note}</p>}
              {row.appeal_note && <p className="text-muted-foreground">Appeal: {row.appeal_note}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => resolveDispute.mutate({ ride_id: row.ride_id, outcome: 'upheld' })}>
                  Uphold
                </Button>
                <Button size="sm" variant="ghost" onClick={() => resolveDispute.mutate({ ride_id: row.ride_id, outcome: 'dismissed' })}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
