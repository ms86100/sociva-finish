// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ShieldAlert, Loader2, Info } from 'lucide-react';
import {
  buyerRiskAdvisoryCopy,
  buyerRiskBandLabel,
  buyerRiskBandTone,
  normalizeBuyerRefundRiskProfile,
  type BuyerRefundRiskProfile,
} from '@/lib/buyer-refund-risk';

interface BuyerTrustProfileCardProps {
  buyerId: string;
  compact?: boolean;
}

export function BuyerTrustProfileCard({ buyerId, compact = false }: BuyerTrustProfileCardProps) {
  const [profile, setProfile] = useState<BuyerRefundRiskProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data, error: rpcError } = await supabase.rpc('get_buyer_refund_risk_profile', {
          p_buyer_id: buyerId,
        });
        if (rpcError) throw rpcError;
        if (!cancelled) {
          setProfile(normalizeBuyerRefundRiskProfile(data));
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(String(err?.message || 'Could not load buyer profile'));
          setProfile(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (buyerId) load();
    return () => { cancelled = true; };
  }, [buyerId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 size={14} className="animate-spin" />
        Loading buyer trust profile…
      </div>
    );
  }

  if (error || !profile) return null;

  const tone = buyerRiskBandTone(profile.band);
  const orders = profile.features?.orders_n ?? 0;
  const refunds = profile.features?.refunds_k ?? 0;

  return (
    <div className={`rounded-lg border ${tone.border} bg-background/60 p-3 space-y-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={14} className={tone.text} />
          <p className="text-xs font-semibold">Buyer trust signal</p>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${tone.badge}`}>
          {buyerRiskBandLabel(profile.band)} · {Math.round(profile.score)}
        </span>
      </div>

      {!compact && (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {buyerRiskAdvisoryCopy(profile)}
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        <span>{orders} order{orders === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{refunds} refund request{refunds === 1 ? '' : 's'}</span>
        {profile.features?.refunds_30d != null && profile.features.refunds_30d > 0 && (
          <>
            <span>·</span>
            <span>{profile.features.refunds_30d} in last 30d</span>
          </>
        )}
      </div>

      <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
        <Info size={11} className="shrink-0 mt-0.5" />
        <span>Advisory only — you always decide whether to approve, partially approve, or reject.</span>
      </div>
    </div>
  );
}
