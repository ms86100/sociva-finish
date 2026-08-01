// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, Eye } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface Props {
  builderId: string;
  builderName: string;
}

interface Society {
  id: string;
  name: string;
}

interface ResolvedFeature {
  feature_key: string;
  is_enabled: boolean;
  source: string;
  society_configurable: boolean;
}

const SOURCE_STYLES: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive'; className: string }> = {
  core: { label: 'Core', variant: 'default', className: 'bg-primary text-primary-foreground text-[8px] h-4' },
  package: { label: 'Package', variant: 'secondary', className: 'bg-success/15 text-success border-success/30 text-[8px] h-4' },
  override: { label: 'Override', variant: 'outline', className: 'bg-warning/15 text-warning border-warning/30 text-[8px] h-4' },
  default: { label: 'Default', variant: 'outline', className: 'text-muted-foreground text-[8px] h-4' },
};

export function SocietyFeatureAudit({ builderId, builderName }: Props) {
  const [open, setOpen] = useState(false);
  const [societies, setSocieties] = useState<Society[]>([]);
  const [selectedSociety, setSelectedSociety] = useState('');
  const [resolvedFeatures, setResolvedFeatures] = useState<ResolvedFeature[]>([]);
  const [loading, setLoading] = useState(false);
  const [societiesLoaded, setSocietiesLoaded] = useState(false);

  const fetchSocieties = async () => {
    if (societiesLoaded) return;
    const { data } = await supabase
      .from('builder_societies')
      .select('society_id, societies:society_id(id, name)')
      .eq('builder_id', builderId);

    const mapped = (data || [])
      .map((d: any) => d.societies)
      .filter(Boolean) as Society[];
    setSocieties(mapped);
    setSocietiesLoaded(true);
  };

  const auditSociety = async (societyId: string) => {
    setSelectedSociety(societyId);
    setLoading(true);
    const { data, error } = await supabase.rpc('get_effective_society_features', {
      _society_id: societyId,
    });
    if (!error && data) {
      setResolvedFeatures(data as ResolvedFeature[]);
    }
    setLoading(false);
  };

  const enabledCount = resolvedFeatures.filter(f => f.is_enabled).length;

  return (
    <Collapsible open={open} onOpenChange={(v) => { setOpen(v); if (v) fetchSocieties(); }}>
      <CollapsibleTrigger asChild>
        <Button size="sm" variant="ghost" className="text-xs gap-1 h-7 px-2">
          <Eye size={12} /> Audit
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 border-t pt-2 space-y-2">
        {societies.length === 0 && societiesLoaded ? (
          <p className="text-xs text-muted-foreground">No societies linked to this builder.</p>
        ) : (
          <Select value={selectedSociety} onValueChange={auditSociety}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a society to audit" />
            </SelectTrigger>
            <SelectContent>
              {societies.map(s => (
                <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {loading && (
          <div className="space-y-1.5">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-6 w-full" />)}
          </div>
        )}

        {!loading && resolvedFeatures.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">
                {enabledCount} of {resolvedFeatures.length} features enabled
              </p>
              <div className="flex gap-1">
                {Object.entries(SOURCE_STYLES).map(([key, style]) => (
                  <Badge key={key} variant={style.variant} className={style.className}>{style.label}</Badge>
                ))}
              </div>
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {resolvedFeatures.map(f => {
                const style = SOURCE_STYLES[f.source] || SOURCE_STYLES.default;
                return (
                  <div key={f.feature_key} className="flex items-center justify-between py-0.5">
                    <div className="flex items-center gap-1.5">
                      {f.is_enabled ? (
                         <Check size={12} className="text-success shrink-0" />
                      ) : (
                         <X size={12} className="text-destructive shrink-0" />
                      )}
                      <span className="text-xs">{f.feature_key}</span>
                    </div>
                    <Badge variant={style.variant} className={style.className}>{style.label}</Badge>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
