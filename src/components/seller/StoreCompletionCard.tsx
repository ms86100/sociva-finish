import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { computeStoreCompletion, type StoreCompletionInput } from '@/lib/store-completion';
import { ChevronRight } from 'lucide-react';

type Props = Omit<StoreCompletionInput, 'productCount'> & { sellerId: string };

export function StoreCompletionCard({ sellerId, ...input }: Props) {
  const { data: productCount = 0 } = useQuery({
    queryKey: ['store-completion-products', sellerId],
    queryFn: async () => {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('seller_id', sellerId)
        .neq('approval_status', 'rejected');
      return count || 0;
    },
    enabled: !!sellerId,
    staleTime: 30_000,
  });

  const result = computeStoreCompletion({ ...input, productCount });
  if (result.percent >= 100 && result.missing.length === 0) return null;

  const helper =
    input.verificationStatus === 'pending'
      ? 'Finish these to strengthen your store while review is in progress.'
      : 'Finish these before you submit for review — you can keep editing from the dashboard.';

  return (
    <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl p-4 space-y-3">
      <div>
        <p className="text-sm font-bold">Store completion: {result.percent}%</p>
        <p className="text-[11px] text-muted-foreground">{helper}</p>
      </div>
      <Progress value={result.percent} className="h-2" />
      <div className="space-y-1.5">
        {result.missing.slice(0, 4).map((item) => (
          <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">{item.label}</span>
            {item.href && (
              <Link to={item.href}>
                <Button variant="link" size="sm" className="h-auto p-0 text-[11px] gap-0.5">
                  Fix <ChevronRight size={10} />
                </Button>
              </Link>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
