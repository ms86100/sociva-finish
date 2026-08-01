// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { useCurrency } from '@/hooks/useCurrency';
import { Pause, Play, X, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface Subscription {
  id: string;
  frequency: string;
  quantity: number;
  delivery_days: string[];
  status: string;
  next_delivery_date: string;
  pause_until: string | null;
  created_at: string;
  product?: { name: string; price: number; image_url: string | null };
  seller?: { business_name: string };
}

export default function MySubscriptionsPage() {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('subscriptions')
      .select('*, product:products(name, price, image_url), seller:seller_profiles(business_name)')
      .eq('buyer_id', user.id)
      .order('created_at', { ascending: false });
    setSubs((data as any) || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchSubs(); }, [fetchSubs]);

  const updateStatus = async (id: string, status: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('subscriptions')
      .update({ status })
      .eq('id', id)
      .eq('buyer_id', user.id);
    if (error) {
      toast({ title: 'Failed to update', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: `Subscription ${status}` });
    fetchSubs();
  };

  return (
    <AppLayout headerTitle="My Subscriptions" showLocation={false}>
      <div className="p-4 space-y-3">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        ) : subs.length === 0 ? (
          <div className="text-center py-12">
            <RefreshCw size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No active subscriptions</p>
            <p className="text-xs text-muted-foreground mt-1">Subscribe to products from your favorite sellers</p>
          </div>
        ) : (
          subs.map(sub => (
            <div key={sub.id} className="bg-card rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {sub.product?.image_url && (
                    <img src={sub.product.image_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-border" />
                  )}
                  <div>
                    <h4 className="font-medium text-sm">{sub.product?.name}</h4>
                    <p className="text-xs text-muted-foreground">{sub.seller?.business_name}</p>
                  </div>
                </div>
                <Badge variant={sub.status === 'active' ? 'default' : 'outline'} className="text-[10px] capitalize">
                  {sub.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>Qty: {sub.quantity}</span>
                <span className="capitalize">{sub.frequency}</span>
                <span className="tabular-nums">{formatPrice((sub.product?.price || 0) * sub.quantity)}/{sub.frequency === 'daily' ? 'day' : sub.frequency === 'weekly' ? 'week' : 'month'}</span>
              </div>
              {sub.status === 'active' && (
                <p className="text-xs text-muted-foreground">
                  Next delivery: {new Date(sub.next_delivery_date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
                </p>
              )}
              <div className="flex gap-2">
                {sub.status === 'active' && (
                  <Button variant="outline" className="gap-1 text-xs" onClick={() => updateStatus(sub.id, 'paused')}>
                    <Pause size={12} /> Pause
                  </Button>
                )}
                {sub.status === 'paused' && (
                  <Button variant="outline" className="gap-1 text-xs" onClick={() => updateStatus(sub.id, 'active')}>
                    <Play size={12} /> Resume
                  </Button>
                )}
                {sub.status !== 'cancelled' && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" className="gap-1 text-xs text-destructive">
                        <X size={14} /> Cancel
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will cancel your subscription for {sub.product?.name}. You can subscribe again later from the seller's page.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                        <AlertDialogAction onClick={() => updateStatus(sub.id, 'cancelled')}>
                          Yes, Cancel
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </AppLayout>
  );
}
