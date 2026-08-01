// @ts-nocheck
import { useQueryClient } from '@tanstack/react-query';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';

/**
 * Fetch arbitrary system_settings keys by their raw key name.
 * Now reads from the shared ['system-settings-all'] cache populated by useMarketplaceConfig.
 * Zero additional network calls.
 */
export function useSystemSettingsRaw(keys: string[]) {
  // Ensure the shared settings cache is populated
  useMarketplaceConfig();

  const queryClient = useQueryClient();

  // Read from the shared cache
  const cached = queryClient.getQueryData<{ sysMap: Record<string, string> }>(['system-settings-all']);
  const sysMap = cached?.sysMap || {};

  return {
    getSetting: (key: string) => sysMap[key] || '',
    settingsMap: sysMap,
  };
}
