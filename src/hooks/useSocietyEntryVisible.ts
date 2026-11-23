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
  // Prefer society_configurable when present; fall back to any enabled feature
  // so residents are not hidden if an older RPC omits the column.
  const hasAnyFeature = features.some((f) => {
    if (!f.is_enabled) return false;
    if (typeof f.society_configurable === 'boolean') return f.society_configurable;
    return true;
  });
  return isSocietyEntryVisible({
    effectiveSocietyId,
    isAdmin: !!isAdmin,
    featuresLoading: isLoading,
    hasAnyFeature,
  });
}
