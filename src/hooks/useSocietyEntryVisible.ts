import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';

export function isSocietyEntryVisible(input: {
  effectiveSocietyId: string | null | undefined;
  isAdmin: boolean;
  featuresLoading: boolean;
  hasAnyFeature: boolean;
}): boolean {
  if (!input.effectiveSocietyId && !input.isAdmin) return false;
  if (!input.featuresLoading && !input.hasAnyFeature && !input.isAdmin) return false;
  return true;
}

/** Single source of truth for whether a "Society" entry point should render. */
export function useSocietyEntryVisible(): boolean {
  const { features, isLoading } = useEffectiveFeatures();
  const { isAdmin, effectiveSocietyId } = useAuth();
  const hasAnyFeature = features.some((f) => f.is_enabled && f.society_configurable);
  return isSocietyEntryVisible({
    effectiveSocietyId,
    isAdmin: !!isAdmin,
    featuresLoading: isLoading,
    hasAnyFeature,
  });
}
