// @ts-nocheck
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import type { FeatureKey } from '@/hooks/useEffectiveFeatures';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ShieldOff, AlertTriangle, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

interface FeatureGateProps {
  feature: FeatureKey | FeatureKey[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function FeatureGate({ feature, children, fallback }: FeatureGateProps) {
  const { isFeatureEnabled, isLoading, isError } = useEffectiveFeatures();
  const { effectiveSocietyId } = useAuth();
  const queryClient = useQueryClient();

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center p-6">
        <AlertTriangle className="text-warning mb-4" size={48} />
        <h2 className="text-lg font-semibold">Could not load features</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          There was a problem loading your society's features. Please try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['effective-features', effectiveSocietyId] })}
        >
          <RefreshCw size={14} className="mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  const features = Array.isArray(feature) ? feature : [feature];
  const hasAccess = features.some(f => isFeatureEnabled(f));

  if (!hasAccess) {
    return fallback ?? (
      <div className="flex flex-col items-center justify-center min-h-[40vh] text-center p-6">
        <ShieldOff className="text-muted-foreground mb-4" size={48} />
        <h2 className="text-lg font-semibold">Feature Not Available</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          This feature is not enabled for your society. Contact your society admin for more information.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
