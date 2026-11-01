// @ts-nocheck
import { FeatureGate } from '@/components/ui/FeatureGate';

export function CleanerCityGate({ children }: { children: React.ReactNode }) {
  return <FeatureGate feature="cleaner_city">{children}</FeatureGate>;
}
