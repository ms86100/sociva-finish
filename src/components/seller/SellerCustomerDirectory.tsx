// @ts-nocheck
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrency } from '@/hooks/useCurrency';
import { Users, Crown, Clock, UserX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

interface CustomerRow {
  buyer_id: string;
  full_name: string;
  avatar_url: string | null;
  order_count: number;
  total_spent: number;
  last_order_date: string;
}

const SEGMENTS = [
  { key: 'all', label: 'All', icon: Users },
  { key: 'regulars', label: 'Regulars', icon: Crown },
  { key: 'recent', label: 'Recent', icon: Clock },
  { key: 'lapsed', label: 'Lapsed', icon: UserX },
] as const;

type Segment = typeof SEGMENTS[number]['key'];

export function SellerCustomerDirectory({ sellerId }: { sellerId: string }) {
  const { formatPrice } = useCurrency();
  const [segment, setSegment] = useState<Segment>('all');

  const { data: customers = [], isLoading } = useQuery<CustomerRow[]>({
    queryKey: ['seller-customers', sellerId],
    enabled: !!sellerId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_seller_customer_directory', { p_seller_id: sellerId });
      if (error) throw error;
      return (data || []) as CustomerRow[];
    },
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    switch (segment) {
      case 'regulars':
        return customers.filter(c => c.order_count >= 3);
      case 'recent':
        return customers.filter(c => now - new Date(c.last_order_date).getTime() <= sevenDays);
      case 'lapsed':
        return customers.filter(c => now - new Date(c.last_order_date).getTime() > thirtyDays);
      default:
        return customers;
    }
  }, [customers, segment]);

  if (isLoading) {
    return <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  }

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">My Customers</h3>
        <Badge variant="secondary" className="text-[10px]">{customers.length} total</Badge>
      </div>

      {/* Segment pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {SEGMENTS.map((seg) => {
          const Icon = seg.icon;
          const isActive = segment === seg.key;
          const count = seg.key === 'all' ? customers.length
            : seg.key === 'regulars' ? customers.filter(c => c.order_count >= 3).length
            : seg.key === 'recent' ? customers.filter(c => Date.now() - new Date(c.last_order_date).getTime() <= 7 * 86400000).length
            : customers.filter(c => Date.now() - new Date(c.last_order_date).getTime() > 30 * 86400000).length;
          return (
            <button
              key={seg.key}
              onClick={() => setSegment(seg.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              <Icon size={12} />
              {seg.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Customer list */}
      {filtered.length > 0 ? (
        <div className="space-y-2">
          {filtered.map((c) => (
            <Card key={c.buyer_id}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                  {c.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.full_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Last order {formatDistanceToNow(new Date(c.last_order_date), { addSuffix: true })}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{c.order_count} orders</p>
                  <p className="text-[10px] text-muted-foreground tabular-nums">{formatPrice(c.total_spent)}</p>
                </div>
                {c.order_count >= 3 && (
                  <Crown size={14} className="text-warning shrink-0" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-muted rounded-xl">
          <Users className="mx-auto text-muted-foreground mb-2" size={24} />
          <p className="text-sm text-muted-foreground">No customers in this segment</p>
        </div>
      )}
    </div>
  );
}
