// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, ShoppingBag, Clock, Plus } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { toast } from 'sonner';
import { formatDistanceToNowStrict } from 'date-fns';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface CollectiveBuy {
  id: string;
  product_id: string;
  target_quantity: number;
  current_quantity: number;
  status: string;
  created_at: string;
  expires_at: string;
  product?: { name: string; price: number; image_url: string | null; seller_id: string };
  created_by_profile?: { name: string };
  participant_count?: number;
  user_joined?: boolean;
}

export default function CollectiveBuyPage() {
  const { user, effectiveSocietyId } = useAuth();
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();
  const [buys, setBuys] = useState<CollectiveBuy[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveSocietyId) fetchBuys();
  }, [effectiveSocietyId]);

  const fetchBuys = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('collective_buy_requests')
      .select('*, product:products(name, price, image_url, seller_id), created_by_profile:profiles!collective_buy_requests_created_by_fkey(name)')
      .eq('society_id', effectiveSocietyId!)
      .in('status', ['active', 'fulfilled'])
      .order('created_at', { ascending: false })
      .limit(20);

    const items = (data || []) as any[];

    if (user && items.length > 0) {
      const { data: participations } = await supabase
        .from('collective_buy_participants')
        .select('request_id')
        .eq('user_id', user.id)
        .in('request_id', items.map(i => i.id));

      const joinedIds = new Set((participations || []).map(p => p.request_id));
      items.forEach(item => { item.user_joined = joinedIds.has(item.id); });
    }

    setBuys(items);
    setLoading(false);
  };

  const handleJoin = async (buyId: string, quantity: number = 1) => {
    if (!user) return;
    setJoining(buyId);
    try {
      const { error } = await supabase
        .from('collective_buy_participants')
        .insert({ request_id: buyId, user_id: user.id, quantity });
      if (error) throw error;
      toast.success('You joined the group buy!');
      fetchBuys();
    } catch (err: any) {
      toast.error(err.message || 'Failed to join');
    } finally {
      setJoining(null);
    }
  };

  const handleLeave = async (buyId: string) => {
    if (!user) return;
    setJoining(buyId);
    try {
      await supabase
        .from('collective_buy_participants')
        .delete()
        .eq('request_id', buyId)
        .eq('user_id', user.id);
      toast.success('You left the group buy');
      fetchBuys();
    } catch {
      toast.error('Failed to leave');
    } finally {
      setJoining(null);
    }
  };

  return (
    <AppLayout headerTitle="Group Buys" showLocation={false}>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">{ml.label('label_group_buy_title')}</h2>
            <p className="text-xs text-muted-foreground">{ml.label('label_group_buy_subtitle')}</p>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
          </div>
        ) : buys.length === 0 ? (
          <div className="text-center py-16">
            <Users className="mx-auto text-muted-foreground mb-3" size={36} />
            <p className="font-semibold">{ml.label('label_group_buy_empty')}</p>
            <p className="text-sm text-muted-foreground mt-1">{ml.label('label_group_buy_empty_desc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {buys.map((buy) => {
              const progress = buy.target_quantity > 0 ? Math.round((buy.current_quantity / buy.target_quantity) * 100) : 0;
              const isFulfilled = buy.status === 'fulfilled';
              const isExpired = new Date(buy.expires_at) < new Date() && !isFulfilled;

              return (
                <Card key={buy.id} className={isExpired ? 'opacity-50' : ''}>
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      {buy.product?.image_url ? (
                        <img src={buy.product.image_url} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <ShoppingBag size={20} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{buy.product?.name || 'Product'}</p>
                        <p className="text-xs text-muted-foreground">{formatPrice(buy.product?.price || 0)} each</p>
                        <div className="flex items-center gap-2 mt-1">
                          {isFulfilled ? (
                            <Badge className="bg-success/10 text-success text-[10px]">{ml.label('label_group_buy_fulfilled')}</Badge>
                          ) : isExpired ? (
                            <Badge variant="secondary" className="text-[10px]">Expired</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              <Clock size={9} className="mr-0.5" />
                              {formatDistanceToNowStrict(new Date(buy.expires_at), { addSuffix: false })} left
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{buy.current_quantity} / {buy.target_quantity} units</span>
                        <span className="font-semibold text-primary">{progress}%</span>
                      </div>
                      <Progress value={progress} className="h-2" />
                    </div>

                    {!isExpired && !isFulfilled && (
                      <div className="mt-3">
                        {buy.user_joined ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => handleLeave(buy.id)}
                            disabled={joining === buy.id}
                          >
                            {ml.label('label_group_buy_leave')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            className="w-full text-xs"
                            onClick={() => handleJoin(buy.id)}
                            disabled={joining === buy.id}
                          >
                            <Plus size={14} className="mr-1" /> {ml.label('label_group_buy_join')}
                          </Button>
                        )}
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground mt-2">
                      Started by {buy.created_by_profile?.name || 'A neighbor'}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
