import { useMemo } from 'react';
import { clearCleanerCityMockupPreview } from '@/lib/cleaner-city/mockupSeed';

/**
 * @deprecated Mockup preview is removed from production Cleaner City.
 * Kept as a no-op so any stray imports fail closed (always disabled).
 */
export function useCleanerCityMockup() {
  clearCleanerCityMockupPreview();
  return useMemo(
    () => ({
      enabled: false,
      enable: () => {
        clearCleanerCityMockupPreview();
      },
      disable: () => {
        clearCleanerCityMockupPreview();
      },
      toggle: () => {
        clearCleanerCityMockupPreview();
      },
    }),
    [],
  );
}
