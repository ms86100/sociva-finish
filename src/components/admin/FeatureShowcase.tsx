// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, ExternalLink, Lock } from 'lucide-react';
import { getFeatureIcon } from '@/lib/feature-showcase-data';
import { useNavigate } from 'react-router-dom';

interface FeatureShowcaseProps {
  featureKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLocked?: boolean;
}

export function FeatureShowcase({ featureKey, open, onOpenChange, isLocked }: FeatureShowcaseProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['feature-showcase', featureKey],
    queryFn: async () => {
      if (!featureKey) return null;
      const { data, error } = await supabase
        .from('platform_features')
        .select('feature_name, description, tagline, audience, capabilities, route, icon_name, category')
        .eq('feature_key', featureKey)
        .single();
      if (error || !data) return null;
      return data;
    },
    enabled: !!featureKey && open,
    staleTime: 10 * 60 * 1000,
  });

  if (!featureKey) return null;

  const Icon = getFeatureIcon(data?.icon_name ?? null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        {isLoading ? (
          <div className="space-y-4 mt-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : data ? (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                  <Icon size={22} />
                </div>
                <div>
                  <SheetTitle className="text-left">{data.feature_name}</SheetTitle>
                  {data.tagline && <p className="text-xs text-muted-foreground">{data.tagline}</p>}
                </div>
              </div>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              {data.description && (
                <p className="text-sm text-foreground leading-relaxed">{data.description}</p>
              )}

              {data.audience && data.audience.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">WHO USES THIS</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.audience.map((a: string) => (
                      <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {data.capabilities && data.capabilities.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">CAPABILITIES</p>
                  <div className="space-y-1.5">
                    {data.capabilities.map((c: string) => (
                      <div key={c} className="flex items-start gap-2">
                        <Check size={14} className="text-primary mt-0.5 shrink-0" />
                        <span className="text-sm">{c}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.category && (
                <Badge variant="outline" className="text-[10px] capitalize">{data.category}</Badge>
              )}

              {isLocked ? (
                <p className="text-xs text-muted-foreground text-center bg-muted rounded-lg p-3">
                  <Lock size={14} className="inline mr-1 -mt-0.5" />
                  This feature is not included in your current plan. Contact your platform admin to upgrade.
                </p>
              ) : data.route ? (
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(data.route!);
                  }}
                >
                  <ExternalLink size={14} />
                  Try this feature
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="text-center py-10 text-muted-foreground text-sm">
            Feature details not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
