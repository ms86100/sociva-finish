// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Inbox, CheckCircle2, GitMerge, XCircle, Clock, ArrowRight } from 'lucide-react';

const STATUS_META: Record<string, { label: string; tone: string; Icon: any }> = {
  pending:   { label: 'Under review', tone: 'bg-amber-500/15 text-amber-700 border-amber-500/30', Icon: Clock },
  approved:  { label: 'Approved',     tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', Icon: CheckCircle2 },
  merged:    { label: 'Use existing', tone: 'bg-blue-500/15 text-blue-700 border-blue-500/30', Icon: GitMerge },
  rejected:  { label: 'Not approved', tone: 'bg-rose-500/15 text-rose-700 border-rose-500/30', Icon: XCircle },
  duplicate: { label: 'Duplicate',    tone: 'bg-muted text-muted-foreground border-border', Icon: Inbox },
};

export default function SellerCategoryRequestsPage() {
  const { user } = useAuth();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['seller', 'category-requests', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_requests')
        .select('*')
        .eq('requested_by', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
  });

  return (
    <AppLayout headerTitle="My Category Requests" showLocation={false}>
      <div className="px-4 pt-4 pb-8 space-y-3 max-w-2xl mx-auto">
        <p className="text-xs text-muted-foreground">
          Track the categories you've asked us to add. We review most requests within 24 hours and notify you here.
        </p>

        {isLoading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-8 text-center text-muted-foreground">
              <Inbox size={28} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No category requests yet.</p>
            </CardContent>
          </Card>
        ) : (
          rows.map((r: any) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.pending;
            const Icon = meta.Icon;
            const resolved = r.created_category || r.merge_target_category;
            const ctaUrl = resolved
              ? (r.draft_product_id ? `/seller/products/${r.draft_product_id}/edit` : `/seller/products/new?category=${resolved}`)
              : null;
            return (
              <Card key={r.id} className="border-border/40 rounded-xl">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{r.requested_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        Submitted {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </div>
                    </div>
                    <Badge variant="outline" className={`text-[10px] gap-1 ${meta.tone}`}>
                      <Icon size={10} /> {meta.label}
                    </Badge>
                  </div>

                  {r.example_product && (
                    <p className="text-[11px] text-muted-foreground italic line-clamp-2">"{r.example_product}"</p>
                  )}

                  {r.status === 'approved' && resolved && (
                    <div className="text-xs text-emerald-700">
                      Live as <span className="font-mono">{resolved}</span>
                    </div>
                  )}
                  {r.status === 'merged' && resolved && (
                    <div className="text-xs text-blue-700">
                      Use existing category <span className="font-mono">{resolved}</span>
                    </div>
                  )}
                  {r.status === 'rejected' && r.rejection_reason && (
                    <div className="text-xs text-rose-700">
                      Reason: {r.rejection_reason}
                    </div>
                  )}
                  {r.status === 'rejected' && r.suggested_alternatives?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Try:</span>
                      {r.suggested_alternatives.map((s: string) => (
                        <Link key={s} to={`/seller/products/new?category=${s}`}
                          className="text-[10px] px-2 py-0.5 rounded-md bg-muted hover:bg-muted/70 border border-border/40">
                          {s}
                        </Link>
                      ))}
                    </div>
                  )}

                  {ctaUrl && (
                    <Link to={ctaUrl}>
                      <Button size="sm" className="w-full mt-1 gap-1.5">
                        {r.draft_product_id ? 'Continue your draft' : 'Add product now'}
                        <ArrowRight size={12} />
                      </Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </AppLayout>
  );
}
