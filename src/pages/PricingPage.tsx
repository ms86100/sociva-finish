// @ts-nocheck
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { jitteredStaleTime } from '@/lib/query-utils';

interface PricingPlan {
  name: string;
  price: string;
  period: string;
  description: string;
  badge: string | null;
  features: string[];
}

const FALLBACK_PLANS: PricingPlan[] = [
  {
    name: 'Free (Buyers)',
    price: 'Free',
    period: 'forever',
    description: 'Browse, order, and connect with your community.',
    badge: null,
    features: [
      'Browse all listings in your society',
      'Place unlimited orders',
      'Chat with sellers',
      'Leave reviews & ratings',
      'Apply coupon codes',
    ],
  },
  {
    name: 'Free (Sellers)',
    price: 'Free',
    period: 'to start',
    description: 'Start selling to your neighbors today.',
    badge: null,
    features: [
      'List up to 10 products/services',
      'Basic seller dashboard',
      'Accept COD & UPI payments',
      'Receive order notifications',
      'Community visibility',
    ],
  },
];

const PRICE_TIER_MAP: Record<string, { priceAmount: number; period: string; badge: string | null }> = {
  free: { priceAmount: 0, period: 'forever', badge: null },
  pro: { priceAmount: 199, period: '/month', badge: 'Popular' },
  enterprise: { priceAmount: 999, period: '/month', badge: 'Enterprise' },
};

function usePricingPlans(currencySymbol: string) {
  return useQuery({
    queryKey: ['pricing-plans'],
    queryFn: async (): Promise<PricingPlan[]> => {
      const { data: packages } = await supabase
        .from('feature_packages')
        .select('id, package_name, description, price_tier, price_amount, price_period')
        .order('created_at', { ascending: true });

      if (!packages || packages.length === 0) return FALLBACK_PLANS;

      const { data: items } = await supabase
        .from('feature_package_items')
        .select('package_id, feature_id, enabled')
        .eq('enabled', true);

      const featureIds = [...new Set((items || []).map(i => i.feature_id))];
      const { data: features } = await supabase
        .from('platform_features')
        .select('id, feature_key, description')
        .in('id', featureIds.length > 0 ? featureIds : ['00000000-0000-0000-0000-000000000000']);

      const featureMap = new Map((features || []).map(f => [f.id, f.description || f.feature_key]));
      const packageFeatures = new Map<string, string[]>();

      for (const item of items || []) {
        if (!item.enabled) continue;
        const list = packageFeatures.get(item.package_id) || [];
        const desc = featureMap.get(item.feature_id);
        if (desc) list.push(desc);
        packageFeatures.set(item.package_id, list);
      }

      const dbPlans: PricingPlan[] = packages.map(pkg => {
        const tierInfo = PRICE_TIER_MAP[pkg.price_tier] || PRICE_TIER_MAP.free;
        const price = (pkg as any).price_amount != null
          ? ((pkg as any).price_amount === 0 ? 'Free' : `${currencySymbol}${(pkg as any).price_amount}`)
          : (tierInfo.priceAmount === 0 ? 'Free' : `${currencySymbol}${tierInfo.priceAmount}`);
        const period = (pkg as any).price_period || tierInfo.period;
        return {
          name: pkg.package_name,
          price,
          period,
          description: pkg.description || '',
          badge: tierInfo.badge,
          features: packageFeatures.get(pkg.id) || [],
        };
      });

      return dbPlans.length > 0 ? dbPlans : FALLBACK_PLANS;
    },
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });
}

export default function PricingPage() {
  const settings = useSystemSettings();
  const { data: plans, isLoading } = usePricingPlans(settings.currencySymbol);

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.history.back()} className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Pricing</h1>
            <p className="text-sm text-muted-foreground">Simple, transparent pricing for everyone</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card rounded-2xl border border-border p-6">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-8 w-1/4 mt-2" />
                <Skeleton className="h-20 w-full mt-4" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {(plans || []).map((plan) => (
              <div key={plan.name} className={`bg-card rounded-2xl border p-6 md:p-8 ${plan.badge === 'Popular' ? 'border-primary shadow-md' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold text-foreground">{plan.name}</h3>
                  {plan.badge && (
                    <span className="text-xs font-bold text-primary-foreground bg-primary px-3 py-1 rounded-full">{plan.badge}</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground text-sm">{plan.period}</span>
                </div>
                <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                <ul className="space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm">
                      <Check className="text-primary shrink-0 mt-0.5" size={16} />
                      <span className="text-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
                {plan.price !== 'Free' && (
                  <Button className="w-full mt-4" variant={plan.badge === 'Popular' ? 'default' : 'outline'} onClick={() => toast.info(`For ${plan.name} inquiries, email ${settings.supportEmail}`)}>
                    Contact Us
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground mt-6">
          All prices are in {settings.currencySymbol === '\u20B9' ? 'INR' : settings.currencySymbol}. Taxes applicable where required.
        </p>

        <div className="mt-6 text-center text-xs text-muted-foreground space-x-4">
          <Link to="/terms" className="hover:text-foreground">Terms & Conditions</Link>
          <span>•</span>
          <Link to="/privacy-policy" className="hover:text-foreground">Privacy Policy</Link>
          <span>•</span>
          <Link to="/refund-policy" className="hover:text-foreground">Refund Policy</Link>
        </div>
      </div>
    </div>
  );
}
