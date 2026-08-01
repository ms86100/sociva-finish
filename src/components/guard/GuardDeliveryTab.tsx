// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  Truck, Search, CheckCircle, XCircle, Package, User, Phone, Home,
  Loader2, ShoppingBag
} from 'lucide-react';

interface DeliveryInfo {
  assignment_id: string;
  order_id: string;
  rider_name: string | null;
  rider_phone: string | null;
  status: string;
  buyer_name: string | null;
  buyer_flat: string | null;
  delivery_code: string | null;
  created_at: string;
}

interface Props {
  societyId: string;
}

export function GuardDeliveryTab({ societyId }: Props) {
  const { user } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'found' | 'not_found'>('idle');
  const [isAllowing, setIsAllowing] = useState(false);

  const handleSearch = async () => {
    if (!searchInput.trim() || !societyId) return;
    setIsSearching(true);
    setDelivery(null);
    setSearchStatus('idle');

    // Search by delivery_code or order ID prefix
    const searchTerm = searchInput.trim();

    // Try delivery_code first
    let { data, error } = await (supabase
      .from('delivery_assignments')
      .select(`
        id, order_id, rider_name, rider_phone, status, delivery_code, created_at,
        order:orders!delivery_assignments_order_id_fkey(
          buyer_id,
          buyer:profiles!orders_buyer_id_fkey(name, flat_number)
        )
      `) as any)
      .eq('society_id', societyId)
      .in('status', ['assigned', 'picked_up', 'at_gate'])
      .or(`delivery_code.eq.${searchTerm},order_id.ilike.${searchTerm}%`)
      .limit(1)
      .maybeSingle();

    if (!data && !error) {
      // Try searching by rider name or phone
      const result = await (supabase
        .from('delivery_assignments')
        .select(`
          id, order_id, rider_name, rider_phone, status, delivery_code, created_at,
          order:orders!delivery_assignments_order_id_fkey(
            buyer_id,
            buyer:profiles!orders_buyer_id_fkey(name, flat_number)
          )
        `) as any)
        .eq('society_id', societyId)
        .in('status', ['assigned', 'picked_up', 'at_gate'])
        .or(`rider_name.ilike.%${searchTerm}%,rider_phone.ilike.%${searchTerm}%`)
        .limit(1)
        .maybeSingle();
      data = result.data;
      error = result.error;
    }

    if (error || !data) {
      setSearchStatus('not_found');
    } else {
      const order = data.order as any;
      setDelivery({
        assignment_id: data.id,
        order_id: data.order_id,
        rider_name: data.rider_name,
        rider_phone: data.rider_phone,
        status: data.status,
        buyer_name: order?.buyer?.name || null,
        buyer_flat: order?.buyer?.flat_number || null,
        delivery_code: data.delivery_code,
        created_at: data.created_at,
      });
      setSearchStatus('found');
    }
    setIsSearching(false);
  };

  const handleAllowEntry = async () => {
    if (!delivery || !user) return;
    setIsAllowing(true);

    // Update delivery status to at_gate
    if (delivery.status !== 'at_gate') {
      await supabase
        .from('delivery_assignments')
        .update({ status: 'at_gate' })
        .eq('id', delivery.assignment_id);
    }

    // Log gate entry
    await supabase.from('gate_entries').insert({
      society_id: societyId,
      user_id: user.id,
      entry_type: 'delivery',
      notes: `Delivery rider: ${delivery.rider_name || 'Unknown'} for Order #${delivery.order_id.slice(0, 8)} → Flat ${delivery.buyer_flat || 'N/A'}`,
      verified_by: user.id,
    });

    // Also check-in the corresponding visitor_entries record if it exists
    await supabase
      .from('visitor_entries')
      .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
      .eq('society_id', societyId)
      .eq('visitor_type', 'delivery')
      .eq('status', 'expected')
      .ilike('purpose', `%${delivery.order_id.slice(0, 8)}%`);

    toast.success(`Delivery rider allowed entry → Flat ${delivery.buyer_flat || 'N/A'}`);
    setDelivery(null);
    setSearchInput('');
    setSearchStatus('idle');
    setIsAllowing(false);
  };

  const handleDeny = () => {
    setDelivery(null);
    setSearchInput('');
    setSearchStatus('idle');
    toast.info('Delivery entry denied');
  };

  const statusLabel: Record<string, string> = {
    assigned: 'Assigned',
    picked_up: 'Picked Up',
    at_gate: 'At Gate',
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/30">
        <CardContent className="p-4 space-y-3">
          <div className="text-center">
            <Truck className="mx-auto text-primary mb-1" size={32} />
            <h3 className="font-bold">Delivery Verification</h3>
            <p className="text-xs text-muted-foreground">Search by delivery code, order ID, rider name, or phone</p>
          </div>

          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Delivery code or rider name..."
              className="text-lg h-12"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isSearching || !searchInput.trim()} className="h-12 px-6">
              {isSearching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {searchStatus === 'not_found' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-4 text-center">
            <XCircle className="mx-auto text-destructive mb-2" size={40} />
            <p className="font-bold text-destructive">No Active Delivery Found</p>
            <p className="text-xs text-muted-foreground mt-1">No matching delivery assignment for this society.</p>
          </CardContent>
        </Card>
      )}

      {searchStatus === 'found' && delivery && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="p-4 space-y-4">
            <div className="text-center">
              <CheckCircle className="mx-auto text-success mb-1" size={40} />
              <p className="font-bold text-success">Delivery Verified</p>
              <Badge variant="outline" className="mt-1">{statusLabel[delivery.status] || delivery.status}</Badge>
            </div>

            <div className="bg-background rounded-lg p-3 space-y-2">
              {delivery.rider_name && (
                <div className="flex items-center gap-2">
                  <User size={16} className="text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Rider</p>
                    <p className="font-medium">{delivery.rider_name}</p>
                  </div>
                </div>
              )}
              {delivery.rider_phone && (
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-muted-foreground" />
                  <p className="text-sm">{delivery.rider_phone}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Order</p>
                  <p className="font-mono text-sm">#{delivery.order_id.slice(0, 8)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Home size={16} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Deliver To</p>
                  <p className="font-medium">{delivery.buyer_name || 'Resident'} {delivery.buyer_flat ? `• Flat ${delivery.buyer_flat}` : ''}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="destructive" size="lg" className="h-12" onClick={handleDeny}>
                <XCircle size={18} className="mr-2" /> Deny
              </Button>
              <Button variant="default" size="lg" className="h-12" onClick={handleAllowEntry} disabled={isAllowing}>
                {isAllowing ? <Loader2 size={18} className="mr-2 animate-spin" /> : <CheckCircle size={18} className="mr-2" />} Allow
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending deliveries list */}
      <PendingDeliveries societyId={societyId} />
    </div>
  );
}

function PendingDeliveries({ societyId }: { societyId: string }) {
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchDeliveries = async () => {
      const { data } = await (supabase
        .from('delivery_assignments')
        .select(`
          id, order_id, rider_name, rider_phone, status, delivery_code, created_at,
          order:orders!delivery_assignments_order_id_fkey(
            buyer:profiles!orders_buyer_id_fkey(name, flat_number)
          )
        `) as any)
        .eq('society_id', societyId)
        .in('status', ['assigned', 'picked_up', 'at_gate'])
        .order('created_at', { ascending: false })
        .limit(10);
      setDeliveries(data || []);
      setIsLoading(false);
    };
    fetchDeliveries();
  }, [societyId]);

  if (isLoading || deliveries.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Active Deliveries ({deliveries.length})</p>
      {deliveries.map(d => {
        const buyer = (d.order as any)?.buyer;
        return (
          <Card key={d.id} className="border-muted">
            <CardContent className="p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{d.rider_name || 'Unassigned Rider'}</p>
                <p className="text-xs text-muted-foreground">
                  Order #{d.order_id.slice(0, 8)} → {buyer?.name || 'Resident'} {buyer?.flat_number ? `• Flat ${buyer.flat_number}` : ''}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] capitalize">
                {d.status.replace('_', ' ')}
              </Badge>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
