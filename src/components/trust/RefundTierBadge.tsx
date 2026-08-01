// @ts-nocheck
import { Zap, Clock, Scale } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  amount: number;
}

interface RefundTier {
  tier: string;
  label: string;
  description: string;
}

function validateRefundTier(data: unknown): RefundTier | null {
  if (data == null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.tier !== 'string' || typeof d.label !== 'string' || typeof d.description !== 'string') return null;
  if (!['instant', '24h', 'mediation'].includes(d.tier)) return null;
  return { tier: d.tier, label: d.label, description: d.description };
}

function getFallbackTier(amount: number): RefundTier {
  if (amount < 200) return { tier: 'instant', label: 'Quick Resolution', description: 'Fast-tracked dispute review' };
  if (amount <= 1000) return { tier: '24h', label: '24h Review', description: 'Reviewed within 24 hours' };
  return { tier: 'mediation', label: 'Dispute Mediation', description: 'Handled by community committee' };
}

export function RefundTierBadge({ amount }: Props) {
  const [tier, setTier] = useState<RefundTier | null>(null);

  useEffect(() => {
    supabase.rpc('get_refund_tier', { _amount: amount }).then(({ data, error }) => {
      if (error) {
        console.warn('[RefundTierBadge] RPC error, using fallback:', error.message);
        setTier(getFallbackTier(amount));
        return;
      }
      const validated = validateRefundTier(data);
      setTier(validated || getFallbackTier(amount));
    });
  }, [amount]);

  if (!tier) return null;

  if (tier.tier === 'instant') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-success">
        <Zap size={10} />
        <span>Fast-tracked dispute resolution</span>
      </div>
    );
  }

  if (tier.tier === '24h') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-primary">
        <Clock size={10} />
        <span>24h dispute review</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      <Scale size={10} />
      <span>Community dispute mediation</span>
    </div>
  );
}
