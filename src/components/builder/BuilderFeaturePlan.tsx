// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Package, Check, Lock, Info, ExternalLink } from 'lucide-react';
import { FeatureShowcase } from '@/components/admin/FeatureShowcase';
import { getFeatureIcon } from '@/lib/feature-showcase-data';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface BuilderFeaturePlanProps {
  builderId: string;
}

interface PackageFeature {
  feature_key: string;
  feature_name: string;
  enabled: boolean;
  is_core: boolean;
  category: string;
  route: string | null;
  icon_name: string | null;
  description: string | null;
}

export function BuilderFeaturePlan({ builderId }: BuilderFeaturePlanProps) {
  const [showcaseKey, setShowcaseKey] = useState<string | null>(null);
  const [showcaseLocked, setShowcaseLocked] = useState(false);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['builder-feature-plan', builderId],
    queryFn: async () => {
      const { data: assignment } = await supabase
        .from('builder_feature_packages')
        .select('id, package_id, assigned_at, expires_at')
        .eq('builder_id', builderId)
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!assignment) return null;

      const { data: pkg } = await supabase
        .from('feature_packages')
        .select('package_name, description, price_tier')
        .eq('id', assignment.package_id)
        .single();

      if (!pkg) return null;

      const { data: items } = await supabase
        .from('feature_package_items')
        .select('feature_id, enabled')
        .eq('package_id', assignment.package_id);

      const { data: allFeatures } = await supabase
        .from('platform_features')
        .select('id, feature_key, feature_name, is_core, category, route, icon_name, description')
        .order('category')
        .order('feature_name');

      const itemMap = new Map((items || []).map(i => [i.feature_id, i.enabled]));

      const features: PackageFeature[] = (allFeatures || []).map(f => ({
        feature_key: f.feature_key,
        feature_name: f.feature_name,
        enabled: f.is_core || (itemMap.has(f.id) && itemMap.get(f.id) === true),
        is_core: f.is_core,
        category: f.category,
        route: f.route,
        icon_name: f.icon_name,
        description: f.description,
      }));

      const enabledCount = features.filter(f => f.enabled).length;

      return {
        packageName: pkg.package_name,
        priceTier: pkg.price_tier,
        description: pkg.description,
        features,
        enabledCount,
        totalCount: features.length,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <Card className="border-dashed border-muted-foreground/30">
        <CardContent className="p-6 text-center">
          <Package size={24} className="mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium text-muted-foreground">No package assigned</p>
          <p className="text-xs text-muted-foreground/70 mt-1">Contact your platform admin to get a feature package.</p>
        </CardContent>
      </Card>
    );
  }

  const tierColors: Record<string, string> = {
    free: 'bg-muted text-muted-foreground',
    basic: 'bg-info/10 text-info',
    pro: 'bg-primary/10 text-primary',
    enterprise: 'bg-warning/10 text-warning',
  };

  // Group features: enabled first, then disabled
  const enabledFeatures = data.features.filter(f => f.enabled);
  const disabledFeatures = data.features.filter(f => !f.enabled);

  return (
    <>
      {/* Plan Summary */}
      <Card className="border-0 shadow-sm bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package size={18} className="text-primary" />
            <span className="text-sm font-bold">Your Plan: {data.packageName}</span>
            <Badge className={`text-[10px] capitalize ${tierColors[data.priceTier] || tierColors.free}`}>
              {data.priceTier}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {data.enabledCount} of {data.totalCount} features included
          </p>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(data.enabledCount / data.totalCount) * 100}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Enabled Feature Cards */}
      {enabledFeatures.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Active Features ({enabledFeatures.length})
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {enabledFeatures.map((f, i) => {
              const Icon = getFeatureIcon(f.icon_name);
              return (
                <motion.div
                  key={f.feature_key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.25 }}
                >
                  <Card
                    className="border-0 shadow-sm hover:shadow-md transition-shadow cursor-pointer group relative overflow-hidden"
                    onClick={() => { setShowcaseKey(f.feature_key); setShowcaseLocked(false); }}
                  >
                    <CardContent className="p-3.5">
                      <div className="flex items-start justify-between mb-2">
                        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Icon size={18} className="text-primary" />
                        </div>
                        <div className="flex items-center gap-1">
                          {f.is_core && (
                            <Badge variant="secondary" className="text-[8px] h-4 px-1">Core</Badge>
                          )}
                          <Check size={14} className="text-primary" />
                        </div>
                      </div>
                      <p className="text-xs font-semibold leading-tight line-clamp-2">
                        {f.feature_name}
                      </p>
                      {f.description && (
                        <p className="text-[10px] text-muted-foreground line-clamp-2 mt-1 leading-snug">
                          {f.description}
                        </p>
                      )}
                      {f.route && (
                        <button
                          className="mt-2 flex items-center gap-1 text-[10px] text-primary font-medium hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(f.route!);
                          }}
                        >
                          <ExternalLink size={10} /> Open
                        </button>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Disabled Feature Cards */}
      {disabledFeatures.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Locked Features ({disabledFeatures.length})
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {disabledFeatures.map((f, i) => {
              const Icon = getFeatureIcon(f.icon_name);
              return (
                <motion.div
                  key={f.feature_key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02, duration: 0.2 }}
                >
                  <Card
                    className="border-0 shadow-sm opacity-60 hover:opacity-80 transition-opacity cursor-pointer"
                    onClick={() => { setShowcaseKey(f.feature_key); setShowcaseLocked(true); }}
                  >
                    <CardContent className="p-3.5">
                      <div className="flex items-start justify-between mb-2">
                        <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Icon size={18} className="text-muted-foreground" />
                        </div>
                        <Lock size={14} className="text-muted-foreground/50" />
                      </div>
                      <p className="text-xs font-semibold leading-tight line-clamp-2 text-muted-foreground">
                        {f.feature_name}
                      </p>
                      {f.description && (
                        <p className="text-[10px] text-muted-foreground/60 line-clamp-2 mt-1 leading-snug">
                          {f.description}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      <FeatureShowcase
        featureKey={showcaseKey}
        open={!!showcaseKey}
        onOpenChange={(open) => !open && setShowcaseKey(null)}
        isLocked={showcaseLocked}
      />
    </>
  );
}
