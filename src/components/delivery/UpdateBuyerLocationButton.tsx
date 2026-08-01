// @ts-nocheck
import { useState } from 'react';
import { MapPin, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getCurrentPosition } from '@/lib/native-location';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  orderId: string;
}

export function UpdateBuyerLocationButton({ orderId }: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');

  const handleUpdate = async () => {
    setStatus('loading');
    try {
      const pos = await getCurrentPosition();

      // Gap 8: Use RPC instead of direct update to prevent column tampering
      const { error } = await supabase.rpc('update_buyer_delivery_location', {
        _order_id: orderId,
        _delivery_lat: pos.latitude,
        _delivery_lng: pos.longitude,
      });

      if (error) throw error;

      setStatus('done');
      toast.success('Delivery location updated', {
        description: 'ETA will recalculate on the next rider update.',
      });

      // Reset after 5s so user can tap again if needed
      setTimeout(() => setStatus('idle'), 5000);
    } catch (err: any) {
      setStatus('idle');
      toast.error('Could not get location', {
        description: err?.message || 'Please enable location access and try again.',
      });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs"
      onClick={handleUpdate}
      disabled={status === 'loading'}
    >
      {status === 'loading' ? (
        <Loader2 size={14} className="animate-spin" />
      ) : status === 'done' ? (
        <Check size={14} className="text-primary" />
      ) : (
        <MapPin size={14} />
      )}
      {status === 'done' ? 'Location Updated' : 'Update My Location'}
    </Button>
  );
}
