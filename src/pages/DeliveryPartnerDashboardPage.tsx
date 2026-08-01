// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Truck, Package, CheckCircle2, Loader2, Radio } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { useBackgroundLocationTracking } from '@/hooks/useBackgroundLocationTracking';
import { DeliveryCompletionOtpDialog } from '@/components/delivery/DeliveryCompletionOtpDialog';
import { DeliveryActionCard } from '@/components/delivery/DeliveryActionCard';

export default function DeliveryPartnerDashboardPage() {
  const { user, effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();
  // useStatusLabels and formatPrice moved to DeliveryActionCard
  const { formatPrice } = useCurrency();
  const [activeTab, setActiveTab] = useState('active');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [activeTrackingId, setActiveTrackingId] = useState<string | null>(null);
  const [otpOrderId, setOtpOrderId] = useState<string | null>(null);

  const { isTracking, startTracking, stopTracking, permissionDenied } = useBackgroundLocationTracking(activeTrackingId);

  // Check if current user is a delivery partner (match by phone, link user_id)
  const { data: partnerProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['my-delivery-partner-profile', effectiveSocietyId, user?.id],
    queryFn: async () => {
      if (!effectiveSocietyId || !user) return null;
      // Find partner by matching phone from profile
      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();
      if (!profile?.phone) return null;

      const { data } = await supabase
        .from('delivery_partner_pool')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .eq('phone', profile.phone)
        .eq('is_active', true)
        .maybeSingle();

      // Link user_id to pool record if not already set (enables GPS auth)
      if (data && !data.user_id) {
        await supabase
          .from('delivery_partner_pool')
          .update({ user_id: user.id })
          .eq('id', data.id);
        data.user_id = user.id;
      }

      return data;
    },
    enabled: !!effectiveSocietyId && !!user,
  });

  // Fetch assigned deliveries
  const { data: deliveries = [], isLoading: deliveriesLoading } = useQuery({
    queryKey: ['my-deliveries', effectiveSocietyId, partnerProfile?.id, activeTab],
    queryFn: async () => {
      if (!effectiveSocietyId || !partnerProfile?.id) return [];
      let query = supabase
        .from('delivery_assignments')
        .select(`
          *,
          order:orders!delivery_assignments_order_id_fkey(
            id, total_amount, delivery_address, notes, created_at,
            buyer:profiles!orders_buyer_id_fkey(name, phone, flat_number, block),
            seller:seller_profiles!orders_seller_id_fkey(business_name)
          )
        `)
        .eq('society_id', effectiveSocietyId)
        .eq('partner_id', partnerProfile.id)
        .order('created_at', { ascending: false });

      if (activeTab === 'active') {
        query = query.not('status', 'in', '(delivered,failed,cancelled)');
      } else {
        query = query.in('status', ['delivered', 'failed', 'cancelled']);
      }

      const { data } = await query.limit(50);
      return data || [];
    },
    enabled: !!effectiveSocietyId && !!partnerProfile?.id,
  });

  // Also fetch unassigned deliveries partner can accept
  const { data: pendingDeliveries = [] } = useQuery({
    queryKey: ['pending-deliveries', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('delivery_assignments')
        .select(`
          *,
          order:orders!delivery_assignments_order_id_fkey(
            id, total_amount, delivery_address, notes, created_at,
            buyer:profiles!orders_buyer_id_fkey(name, flat_number, block),
            seller:seller_profiles!orders_seller_id_fkey(business_name)
          )
        `)
        .eq('society_id', effectiveSocietyId)
        .eq('status', 'pending')
        .is('partner_id', null)
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!effectiveSocietyId && !!partnerProfile?.id,
  });
  // Transit tracking callback from DeliveryActionCard
  const transitDeliveriesRef = useRef<Set<string>>(new Set());
  const handleTransitDetected = useCallback((assignmentId: string, isTransit: boolean) => {
    if (isTransit && !activeTrackingId) {
      setActiveTrackingId(assignmentId);
    }
    if (isTransit) {
      transitDeliveriesRef.current.add(assignmentId);
    } else {
      transitDeliveriesRef.current.delete(assignmentId);
    }
  }, [activeTrackingId]);

  // Auto-start when tracking ID is set
  useEffect(() => {
    if (activeTrackingId && !isTracking) {
      startTracking();
    }
  }, [activeTrackingId, isTracking, startTracking]);

  const updateDeliveryStatus = async (assignmentId: string, newStatus: string) => {
    setUpdatingId(assignmentId);
    const updates: any = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === 'picked_up') updates.pickup_at = new Date().toISOString();
    if (newStatus === 'delivered') updates.delivered_at = new Date().toISOString();

    const { error } = await supabase
      .from('delivery_assignments')
      .update(updates)
      .eq('id', assignmentId);

    if (error) toast.error('Failed to update status');
    else {
      toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
      // Start/stop GPS tracking based on new status
      if (newStatus === 'picked_up') {
        setActiveTrackingId(assignmentId);
      } else if (['delivered', 'failed', 'cancelled'].includes(newStatus)) {
        setActiveTrackingId(null);
        stopTracking();
      }
      queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['pending-deliveries'] });
    }
    setUpdatingId(null);
  };

  const acceptDelivery = async (assignmentId: string) => {
    if (!partnerProfile) return;
    setUpdatingId(assignmentId);
    const { error } = await supabase
      .from('delivery_assignments')
      .update({
        rider_id: partnerProfile.id,
        status: 'assigned',
        rider_name: partnerProfile.name,
        rider_phone: partnerProfile.phone,
        rider_photo_url: partnerProfile.photo_url,
        updated_at: new Date().toISOString(),
      })
      .eq('id', assignmentId)
      .eq('status', 'pending');

    if (error) toast.error('Failed to accept delivery');
    else {
      toast.success('Delivery accepted!');
      queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['pending-deliveries'] });
    }
    setUpdatingId(null);
  };

  const toggleAvailability = async () => {
    if (!partnerProfile) return;
    const { error } = await supabase
      .from('delivery_partner_pool')
      .update({ is_available: !partnerProfile.is_available, updated_at: new Date().toISOString() })
      .eq('id', partnerProfile.id);
    if (!error) {
      queryClient.invalidateQueries({ queryKey: ['my-delivery-partner-profile'] });
      toast.success(partnerProfile.is_available ? 'Marked as unavailable' : 'Marked as available');
    }
  };

  // statusConfig is now provided by useStatusLabels().getDeliveryStatus

  if (profileLoading) {
    return (
      <AppLayout headerTitle="My Deliveries" showLocation={false}>
        <div className="p-4 space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }

  if (!partnerProfile) {
    return (
      <AppLayout headerTitle="My Deliveries" showLocation={false}>
        <div className="p-4 text-center py-20 text-muted-foreground">
          <Truck size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">Not a Delivery Partner</p>
          <p className="text-sm mt-1">You are not registered as a delivery partner in this society.</p>
          <p className="text-xs mt-2">Contact your society admin to be added to the delivery pool.</p>
        </div>
      </AppLayout>
    );
  }

  const activeCount = deliveries.filter(d => !['delivered', 'failed', 'cancelled'].includes(d.status)).length;

  return (
    <AppLayout headerTitle="My Deliveries" showLocation={false}>
      <FeatureGate feature="delivery_management">
      <div className="p-4 space-y-4">
        {/* Partner Status Card */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {partnerProfile.photo_url ? (
                  <img src={partnerProfile.photo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Truck className="text-primary" size={24} />
                  </div>
                )}
                <div>
                  <p className="font-semibold">{partnerProfile.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Package size={12} /> <span className="tabular-nums">{partnerProfile.total_deliveries}</span> deliveries
                    {partnerProfile.rating > 0 && <span className="tabular-nums">· ⭐ {partnerProfile.rating}</span>}
                    {isTracking && (
                      <span className="flex items-center gap-1 text-primary">
                        <Radio size={10} className="animate-pulse" /> GPS
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant={partnerProfile.is_available ? 'default' : 'outline'}
                onClick={toggleAvailability}
              >
                {partnerProfile.is_available ? '🟢 Online' : '⚪ Offline'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Pending Deliveries to Accept */}
        {pendingDeliveries.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-warning">📦 {pendingDeliveries.length} delivery request(s) available</p>
            {pendingDeliveries.map((d: any) => (
              <Card key={d.id} className="border-warning/30">
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">{d.order?.seller?.business_name || 'Order'}</p>
                    <Badge className="text-[10px] bg-warning/10 text-warning">New</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    📍 {d.order?.buyer?.block}-{d.order?.buyer?.flat_number}
                  </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        💰 Delivery fee: {formatPrice(d.delivery_fee)}
                  </p>
                  <Button
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => acceptDelivery(d.id)}
                    disabled={updatingId === d.id}
                  >
                    {updatingId === d.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CheckCircle2 size={14} className="mr-1" />}
                    Accept Delivery
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* My Deliveries Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="active" className="text-xs">Active ({activeTab === 'active' ? deliveries.length : activeCount})</TabsTrigger>
            <TabsTrigger value="completed" className="text-xs">History</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-3 space-y-3">
            {deliveriesLoading ? (
              [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
            ) : deliveries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="mx-auto mb-3" size={32} />
                <p className="text-sm">No {activeTab === 'active' ? 'active' : 'completed'} deliveries</p>
              </div>
            ) : (
              deliveries.map((delivery: any) => (
                <DeliveryActionCard
                  key={delivery.id}
                  delivery={delivery}
                  updatingId={updatingId}
                  onUpdateStatus={updateDeliveryStatus}
                  onOtpVerify={(orderId) => setOtpOrderId(orderId)}
                  onTransitDetected={handleTransitDetected}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>

      {/* OTP verification dialog — all delivery completions must go through this */}
      {otpOrderId && (
        <DeliveryCompletionOtpDialog
          orderId={otpOrderId}
          open={!!otpOrderId}
          onOpenChange={(open) => { if (!open) setOtpOrderId(null); }}
          onVerified={() => {
            setOtpOrderId(null);
            setActiveTrackingId(null);
            stopTracking();
            queryClient.invalidateQueries({ queryKey: ['my-deliveries'] });
            queryClient.invalidateQueries({ queryKey: ['pending-deliveries'] });
          }}
        />
      )}
    </AppLayout>
  );
}
