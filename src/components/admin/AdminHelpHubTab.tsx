// @ts-nocheck
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { useState } from 'react';
import { HELPHUB_SOURCE_LABELS } from '@/lib/helphub/constants';

export function AdminHelpHubTab() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['helphub-admin-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('helphub_admin_stats');
      if (error) throw error;
      return data as Record<string, number>;
    },
    retry: 1,
  });

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['helphub-admin-listings', status, query],
    queryFn: async () => {
      let q = supabase
        .from('helphub_listings')
        .select('id, display_name, category, status, source, society_id, expires_at, created_at, recommender_name')
        .order('created_at', { ascending: false })
        .limit(100);
      if (status !== 'all') q = q.eq('status', status);
      if (query.trim()) q = q.ilike('display_name', `%${query.trim()}%`);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const { data: reports = [] } = useQuery({
    queryKey: ['helphub-admin-reports'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('helphub_reports')
        .select('id, reason, status, created_at, listing_id, details')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    },
    retry: 1,
  });

  const suspend = useMutation({
    mutationFn: async (listingId: string) => {
      const { error } = await supabase.rpc('helphub_update_listing_status', {
        p_listing_id: listingId,
        p_status: 'suspended',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Listing suspended');
      queryClient.invalidateQueries({ queryKey: ['helphub-admin-listings'] });
      queryClient.invalidateQueries({ queryKey: ['helphub-admin-stats'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Suspend failed'),
  });

  const restore = useMutation({
    mutationFn: async (listingId: string) => {
      const { error } = await supabase.rpc('helphub_renew_listing', {
        p_listing_id: listingId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Listing restored');
      queryClient.invalidateQueries({ queryKey: ['helphub-admin-listings'] });
    },
    onError: (e: any) => toast.error(e?.message || 'Restore failed'),
  });

  return (
    <div className="space-y-6 p-1">
      <div>
        <h2 className="text-lg font-bold">HelpHub</h2>
        <p className="text-sm text-muted-foreground">
          Moderate society help listings, reports, and enquiry health.
        </p>
      </div>

      {statsLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Active', stats.active_listings],
            ['Recommendations', stats.resident_recommendations],
            ['Enquiries', stats.enquiries],
            ['Open reports', stats.reported],
            ['Hired', stats.hired],
            ['Expired', stats.expired],
            ['Self / assisted', stats.workers_registered],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border p-3">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="text-lg font-bold">{value ?? 0}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Stats unavailable until the HelpHub migration is applied.
        </p>
      )}

      {reports.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Open reports</h3>
          {reports.map((r: any) => (
            <div key={r.id} className="rounded-xl border border-border p-3 text-sm">
              <p className="font-medium">{r.reason}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Listing {r.listing_id} · {new Date(r.created_at).toLocaleString()}
              </p>
              {r.details && <p className="text-xs mt-1">{r.details}</p>}
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => suspend.mutate(r.listing_id)}
              >
                Suspend listing
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="max-w-xs"
        />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="hired">Hired</option>
          <option value="expired">Expired</option>
          <option value="removed">Removed</option>
          <option value="all">All</option>
        </select>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-2">
          {listings.map((l: any) => (
            <div
              key={l.id}
              className="rounded-xl border border-border p-3 flex flex-wrap items-center justify-between gap-2"
            >
              <div>
                <p className="font-medium text-sm">{l.display_name}</p>
                <p className="text-xs text-muted-foreground">
                  {l.category} · {HELPHUB_SOURCE_LABELS[l.source] || l.source} · expires{' '}
                  {new Date(l.expires_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{l.status}</Badge>
                {l.status !== 'suspended' ? (
                  <Button size="sm" variant="outline" onClick={() => suspend.mutate(l.id)}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => restore.mutate(l.id)}>
                    Restore
                  </Button>
                )}
              </div>
            </div>
          ))}
          {listings.length === 0 && (
            <p className="text-sm text-muted-foreground">No listings for this filter.</p>
          )}
        </div>
      )}
    </div>
  );
}
