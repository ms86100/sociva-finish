// @ts-nocheck
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useHelpHubMode } from '@/hooks/queries/useHelpHub';

/**
 * Allows demo=1 prototype without feature flag.
 * Until helphub is rolled out everywhere, also accept worker_marketplace / domestic_help.
 */
export function HelpHubGate({ children }: { children: React.ReactNode }) {
  const { forcedDemo } = useHelpHubMode();
  if (forcedDemo) return <>{children}</>;
  return (
    <FeatureGate feature={['helphub', 'worker_marketplace', 'domestic_help']}>
      {children}
    </FeatureGate>
  );
}
