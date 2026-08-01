// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Check, X, ChevronDown, Layers } from 'lucide-react';
import { FeatureShowcase } from '@/components/admin/FeatureShowcase';

interface BuilderSocietyFeaturesProps {
  societyId: string;
}

interface EffectiveFeature {
  feature_key: string;
  is_enabled: boolean;
  source: string;
  society_configurable: boolean;
}

const sourceColors: Record<string, string> = {
  core: 'bg-blue-500/10 text-blue-600',
  package: 'bg-primary/10 text-primary',
  override: 'bg-amber-500/10 text-amber-700',
  default: 'bg-muted text-muted-foreground',
};

export function BuilderSocietyFeatures({ societyId }: BuilderSocietyFeaturesProps) {
  const [open, setOpen] = useState(false);
  const [showcaseKey, setShowcaseKey] = useState<string | null>(null);

  const { data: features, isLoading } = useQuery({
    queryKey: ['society-effective-features', societyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_effective_society_features', {
        _society_id: societyId,
      });
      if (error) return [];
      return (data || []) as EffectiveFeature[];
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const enabledCount = features?.filter(f => f.is_enabled).length ?? 0;
  const totalCount = features?.length ?? 0;

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded hover:bg-primary/20 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Layers size={10} />
            Features
            {open && totalCount > 0 && ` (${enabledCount}/${totalCount})`}
            <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent onClick={(e) => e.stopPropagation()}>
          <div className="mt-2 border-t pt-2 space-y-1">
            {isLoading && <Skeleton className="h-16 w-full" />}
            {features?.map(f => (
              <button
                key={f.feature_key}
                className="flex items-center gap-1.5 w-full text-left py-0.5 hover:bg-muted/50 rounded px-1 transition-colors"
                onClick={() => setShowcaseKey(f.feature_key)}
              >
                {f.is_enabled ? (
                  <Check size={11} className="text-primary shrink-0" />
                ) : (
                  <X size={11} className="text-destructive/50 shrink-0" />
                )}
                <span className={`text-[11px] flex-1 ${f.is_enabled ? '' : 'text-muted-foreground/50'}`}>
                  {f.feature_key.replace(/_/g, ' ')}
                </span>
                <Badge className={`text-[8px] h-3.5 px-1 ${sourceColors[f.source] || sourceColors.default}`}>
                  {f.source}
                </Badge>
              </button>
            ))}
            {features?.length === 0 && !isLoading && (
              <p className="text-[10px] text-muted-foreground text-center py-2">No feature data</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <FeatureShowcase
        featureKey={showcaseKey}
        open={!!showcaseKey}
        onOpenChange={(open) => !open && setShowcaseKey(null)}
      />
    </>
  );
}
