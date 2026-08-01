// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface AvailabilityPromptBannerProps {
  sellerId: string;
}

export function AvailabilityPromptBanner({ sellerId }: AvailabilityPromptBannerProps) {
  const navigate = useNavigate();

  const { data: needsSetup } = useQuery({
    queryKey: ['availability-prompt', sellerId],
    queryFn: async () => {
      const [productsRes, scheduleRes] = await Promise.all([
        supabase.from('products').select('id').eq('seller_id', sellerId).limit(1),
        supabase.from('service_availability_schedules')
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', sellerId)
          .is('product_id', null)
          .eq('is_active', true),
      ]);

      const products = productsRes.data;
      if (!products || products.length === 0) return false;

      const scheduleCount = scheduleRes.count || 0;
      if (scheduleCount > 0) return false;

      const { count: listingCount } = await (supabase
        .from('service_listings') as any)
        .select('id', { count: 'exact', head: true })
        .in('product_id', products.map(p => p.id));

      return (listingCount || 0) > 0;
    },
    enabled: !!sellerId,
    staleTime: 60_000,
  });

  if (!needsSetup) return null;

  return (
    <div className="p-3.5 rounded-xl bg-warning/10 border border-warning/20 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-warning/20 flex items-center justify-center shrink-0 mt-0.5">
        <AlertTriangle size={16} className="text-warning" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Set your Store Hours</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          You have service products but no Store Hours configured. Booking slots are generated automatically from your Store Hours — set them up so buyers can book.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 h-7 text-xs gap-1"
          onClick={() => navigate('/seller/settings')}
        >
          Set Store Hours <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}
