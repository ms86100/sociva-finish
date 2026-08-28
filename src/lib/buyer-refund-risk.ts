export type BuyerRefundRiskBand = 'low' | 'medium' | 'high';

export interface BuyerRefundRiskProfile {
  buyer_id?: string;
  score: number;
  band: BuyerRefundRiskBand;
  recommendation: string;
  features?: {
    orders_n?: number;
    refunds_k?: number;
    refund_rate?: number;
    refunds_30d?: number;
    orders_30d?: number;
    components?: Record<string, number>;
    above_cohort?: boolean;
  };
}

export function normalizeBuyerRefundRiskProfile(raw: unknown): BuyerRefundRiskProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const band = String(data.band || 'low').toLowerCase();
  if (!['low', 'medium', 'high'].includes(band)) return null;
  return {
    buyer_id: data.buyer_id ? String(data.buyer_id) : undefined,
    score: Number(data.score) || 0,
    band: band as BuyerRefundRiskBand,
    recommendation: String(data.recommendation || ''),
    features: (data.features as BuyerRefundRiskProfile['features']) || undefined,
  };
}

export function buyerRiskBandLabel(band: BuyerRefundRiskBand): string {
  if (band === 'low') return 'Low risk';
  if (band === 'medium') return 'Medium risk';
  return 'High risk';
}

export function buyerRiskBandTone(band: BuyerRefundRiskBand): {
  badge: string;
  border: string;
  text: string;
} {
  if (band === 'low') {
    return {
      badge: 'bg-success/10 text-success border-success/20',
      border: 'border-success/20',
      text: 'text-success',
    };
  }
  if (band === 'medium') {
    return {
      badge: 'bg-warning/10 text-warning border-warning/20',
      border: 'border-warning/20',
      text: 'text-warning',
    };
  }
  return {
    badge: 'bg-destructive/10 text-destructive border-destructive/20',
    border: 'border-destructive/20',
    text: 'text-destructive',
  };
}

export function buyerRiskAdvisoryCopy(profile: BuyerRefundRiskProfile): string {
  if (profile.recommendation?.trim()) return profile.recommendation.trim();
  if (profile.band === 'low') {
    return 'Likely genuine complaint. Refund history is within normal range.';
  }
  if (profile.band === 'medium') {
    return 'Review carefully — this buyer requests refunds more often than typical.';
  }
  return 'Potential refund abuse — review evidence before approving.';
}
