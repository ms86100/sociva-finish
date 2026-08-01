// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, friendlyError } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { DAYS_OF_WEEK } from '@/types/database';
import { useCurrency } from '@/hooks/useCurrency';

interface SubscriptionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: { id: string; name: string; price: number; seller_id: string } | null;
}

export function SubscriptionSheet({ open, onOpenChange, product }: SubscriptionSheetProps) {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [frequency, setFrequency] = useState('daily');
  const [quantity, setQuantity] = useState(1);
  const [deliveryDays, setDeliveryDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const toggleDay = (day: string) => {
    setDeliveryDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleSubscribe = async () => {
    if (!product || !user) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('subscriptions').insert({
        buyer_id: user.id,
        seller_id: product.seller_id,
        product_id: product.id,
        frequency,
        quantity,
        delivery_days: frequency === 'weekly' ? deliveryDays : [],
        next_delivery_date: new Date().toISOString().split('T')[0],
      });
      if (error) throw error;
      toast({ title: 'Subscribed!', description: `You'll receive ${product.name} ${frequency}` });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Failed', description: friendlyError(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  if (!product) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Subscribe to {product.name}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 mt-4">
          <div className="p-3 rounded-lg bg-muted/50 border border-border">
            <p className="font-medium text-sm">{product.name}</p>
            <p className="text-xs text-muted-foreground">{formatPrice(product.price)} per unit</p>
          </div>

          <div>
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Quantity</Label>
            <div className="flex items-center gap-3 mt-1">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(Math.max(1, quantity - 1))}>-</Button>
              <span className="font-medium text-sm w-8 text-center">{quantity}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setQuantity(quantity + 1)}>+</Button>
            </div>
          </div>

          {frequency === 'weekly' && (
            <div>
              <Label>Delivery Days</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                      deliveryDays.includes(day)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card border-border text-muted-foreground'
                    )}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-3 rounded-lg bg-secondary/50 border border-border">
            <p className="text-xs text-secondary-foreground">
              Estimated cost: <strong>{formatPrice(product.price * quantity)}</strong> per {frequency === 'daily' ? 'day' : frequency === 'weekly' ? 'delivery' : 'month'}
            </p>
          </div>

          <Button className="w-full" onClick={handleSubscribe} disabled={loading}>
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
            Start Subscription
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
