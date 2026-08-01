// @ts-nocheck
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';

interface PlatformFeature {
  id: string;
  feature_key: string;
  feature_name: string;
  category: string;
  is_core: boolean;
}

interface FeaturePackage {
  id: string;
  package_name: string;
  price_tier: string;
}

interface Props {
  features: PlatformFeature[];
  packages: FeaturePackage[];
  packageItems: Record<string, Record<string, boolean>>; // packageId -> featureId -> enabled
}

const TIER_ORDER = ['free', 'basic', 'pro', 'enterprise'];
const CATEGORIES = ['governance', 'marketplace', 'finance', 'operations', 'construction'];

export function PackageComparisonMatrix({ features, packages, packageItems }: Props) {
  const sortedPackages = [...packages].sort(
    (a, b) => TIER_ORDER.indexOf(a.price_tier) - TIER_ORDER.indexOf(b.price_tier)
  );

  const groupedFeatures = CATEGORIES.reduce((acc, cat) => {
    const catFeatures = features.filter(f => f.category === cat);
    if (catFeatures.length > 0) acc[cat] = catFeatures;
    return acc;
  }, {} as Record<string, PlatformFeature[]>);

  const getEnabledCount = (pkgId: string) =>
    features.filter(f => f.is_core || packageItems[pkgId]?.[f.id]).length;

  if (packages.length === 0) {
    return <p className="text-center text-muted-foreground py-4 text-sm">Create packages first to compare them.</p>;
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs w-[140px]">Feature</TableHead>
            {sortedPackages.map(pkg => (
              <TableHead key={pkg.id} className="text-center text-xs px-2">
                <div>{pkg.package_name}</div>
                <Badge variant="outline" className="text-[8px] capitalize mt-0.5">{pkg.price_tier}</Badge>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {CATEGORIES.map(cat =>
            groupedFeatures[cat]?.map((f, idx) => (
              <TableRow key={f.id}>
                <TableCell className="py-1.5 px-2">
                  <div className="flex items-center gap-1">
                    {idx === 0 && (
                      <span className="text-[9px] font-bold text-muted-foreground uppercase mr-1">{cat.slice(0, 3)}</span>
                    )}
                    <span className="text-xs truncate">{f.feature_name}</span>
                    {f.is_core && <Badge variant="secondary" className="text-[7px] h-3 px-1">Core</Badge>}
                  </div>
                </TableCell>
                {sortedPackages.map(pkg => {
                  const enabled = f.is_core || packageItems[pkg.id]?.[f.id];
                  return (
                    <TableCell key={pkg.id} className="text-center py-1.5 px-2">
                      {enabled ? (
                        <Check size={14} className="mx-auto text-success" />
                      ) : (
                        <X size={14} className="mx-auto text-muted-foreground/40" />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))
          )}
          {/* Summary row */}
          <TableRow className="bg-muted/30 font-semibold">
            <TableCell className="py-1.5 px-2 text-xs">Total Enabled</TableCell>
            {sortedPackages.map(pkg => (
              <TableCell key={pkg.id} className="text-center py-1.5 px-2 text-xs">
                {getEnabledCount(pkg.id)} / {features.length}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
