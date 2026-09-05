// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles, ArrowRight, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';

export function useOpenCategoryRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['seller', 'category-requests', 'open', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_requests')
        .select('id, requested_name, status, created_at, request_kind')
        .eq('requested_by', user!.id)
        .in('status', ['pending', 'approved', 'merged'])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

function requestKindLabel(rows: any[]): { titlePending: string; titleReady: string; bodyPending: string; bodyReady: string } {
  const pending = rows.filter((r) => r.status === 'pending');
  const ready = rows.filter((r) => r.status === 'approved' || r.status === 'merged');
  const allSub =
    rows.length > 0 &&
    rows.every((r) => r.request_kind === 'subcategory' || r.created_subcategory_id);
  const pendingSubs = pending.every(
    (r) => !r.request_kind || r.request_kind === 'subcategory',
  ) && pending.length > 0;
  const noun = allSub || pendingSubs ? 'subcategory' : 'category';
  const nounPlural = `${noun} request`;
  const pendingNames = pending.map((r: any) => r.requested_name).filter(Boolean);
  const names = pendingNames.join(', ') || 'Your request';
  const waitingVerb = pendingNames.length === 1 ? 'is' : 'are';

  return {
    titlePending: `${pending.length} ${nounPlural}${pending.length > 1 ? 's' : ''} under review`,
    titleReady: `${ready.length} ${noun} request${ready.length > 1 ? 's' : ''} ready`,
    bodyPending:
      noun === 'subcategory'
        ? `${names} ${waitingVerb} waiting for admin review — you can already use ${pendingNames.length === 1 ? 'it' : 'them'} on your listing. We’ll notify you when ${pendingNames.length === 1 ? "it's" : "they're"} approved.`
        : `${names} ${waitingVerb === 'is' ? 'isn’t' : 'aren’t'} live yet. We’ll notify you when ${pendingNames.length === 1 ? "it's" : "they're"} approved.`,
    bodyReady:
      noun === 'subcategory'
        ? 'Your proposed subcategory was approved — keep using it in your listings.'
        : 'Your requested category is available — select it below or continue onboarding.',
  };
}

export function PendingCategoryRequestsBanner({
  variant = 'link',
}: {
  /** inline = non-navigating card for onboarding (avoids SellerRoute bounce) */
  variant?: 'link' | 'inline';
}) {
  const { data: rows = [] } = useOpenCategoryRequests();

  if (rows.length === 0) return null;

  const pending = rows.filter((r: any) => r.status === 'pending');
  const ready = rows.filter((r: any) => r.status === 'approved' || r.status === 'merged');
  const copy = requestKindLabel(rows);

  const body = (
    <div className="flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
        {ready.length > 0 ? <Sparkles size={18} className="text-primary" /> : <Clock size={18} className="text-primary" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-foreground">
            {ready.length > 0 ? copy.titleReady : copy.titlePending}
          </span>
          <Badge variant="secondary" className="text-[10px] h-5">
            {rows.length} total
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
          {ready.length > 0 ? copy.bodyReady : copy.bodyPending}
        </p>
        {variant === 'link' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-primary mt-2">
            View requests <ArrowRight size={12} />
          </span>
        )}
      </div>
      {variant === 'link' && <ArrowRight size={16} className="text-primary mt-1 shrink-0" />}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className="w-full rounded-2xl border border-primary/30 bg-primary/5 p-4 mb-4">
        {body}
      </div>
    );
  }

  return (
    <Link
      to="/seller/category-requests"
      className="block w-full text-left rounded-2xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors p-4 mb-4"
    >
      {body}
    </Link>
  );
}
