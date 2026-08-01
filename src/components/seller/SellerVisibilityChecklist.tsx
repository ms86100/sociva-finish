// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSellerHealth, SellerHealthCheck } from '@/hooks/queries/useSellerHealth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { CheckCircle2, AlertTriangle, XCircle, Info, ShieldCheck, ChevronRight, ShieldAlert, Package, Globe, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetStoreLocationSheet } from './SetStoreLocationSheet';

const STATUS_CONFIG = {
  pass: { icon: CheckCircle2, color: 'text-success', bg: 'bg-success/10' },
  warn: { icon: AlertTriangle, color: 'text-warning', bg: 'bg-warning/10' },
  fail: { icon: XCircle, color: 'text-destructive', bg: 'bg-destructive/10' },
  info: { icon: Info, color: 'text-primary', bg: 'bg-primary/10' },
} as const;

const GROUP_CONFIG = {
  critical: { label: 'Visibility Requirements', icon: ShieldAlert, description: 'Must pass for buyers to see you' },
  products: { label: 'Product Health', icon: Package, description: 'Product listing status' },
  discovery: { label: 'Discovery & Reach', icon: Globe, description: 'Cross-society visibility' },
  quality: { label: 'Store Quality', icon: Sparkles, description: 'Improves buyer trust & conversion' },
} as const;

function CheckItem({ check, onSpecialAction }: { check: SellerHealthCheck; onSpecialAction?: (route: string) => void }) {
  const config = STATUS_CONFIG[check.status];
  const Icon = config.icon;

  const handleAction = () => {
    if (check.actionRoute?.startsWith('#') && onSpecialAction) {
      onSpecialAction(check.actionRoute);
    }
  };

  return (
    <div className={cn('flex items-start gap-3 p-2.5 rounded-lg', config.bg)}>
      <Icon size={16} className={cn('shrink-0 mt-0.5', config.color)} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium">{check.label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{check.message}</p>
        {check.actionLabel && check.actionRoute && (
          check.actionRoute.startsWith('#') ? (
            <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-[10px] gap-1" onClick={handleAction}>
              {check.actionLabel}
              <ChevronRight size={10} />
            </Button>
          ) : (
            <Link to={check.actionRoute}>
              <Button variant="link" size="sm" className="h-auto p-0 mt-1 text-[10px] gap-1">
                {check.actionLabel}
                <ChevronRight size={10} />
              </Button>
            </Link>
          )
        )}
      </div>
    </div>
  );
}

function CheckGroup({ groupKey, checks, onSpecialAction }: { groupKey: keyof typeof GROUP_CONFIG; checks: SellerHealthCheck[]; onSpecialAction?: (route: string) => void }) {
  if (checks.length === 0) return null;
  const config = GROUP_CONFIG[groupKey];
  const GroupIcon = config.icon;
  const hasIssues = checks.some(c => c.status === 'fail' || c.status === 'warn');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <GroupIcon size={12} className={hasIssues ? 'text-warning' : 'text-muted-foreground'} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{config.label}</span>
      </div>
      {checks.map(check => (
        <CheckItem key={check.key} check={check} onSpecialAction={onSpecialAction} />
      ))}
    </div>
  );
}

export function SellerVisibilityChecklist({ sellerId }: { sellerId: string }) {
  const { data, isLoading } = useSellerHealth(sellerId);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-16 w-full rounded-xl" />;
  }

  if (!data || data.checks.length === 0) return null;

  const { checks, passCount, totalChecks, isFullyVisible, criticalBlockers } = data;

  const percentage = totalChecks > 0 ? Math.round((passCount / totalChecks) * 100) : 0;

  const issues = checks.filter(c => c.status === 'fail' || c.status === 'warn');

  // Group checks for drawer
  const criticalChecks = checks.filter(c => c.group === 'critical');
  const productChecks = checks.filter(c => c.group === 'products');
  const discoveryChecks = checks.filter(c => c.group === 'discovery');
  const qualityChecks = checks.filter(c => c.group === 'quality');

  const sortByStatus = (a: SellerHealthCheck, b: SellerHealthCheck) => {
    const order = { fail: 0, warn: 1, info: 2, pass: 3 };
    return order[a.status] - order[b.status];
  };
  criticalChecks.sort(sortByStatus);
  productChecks.sort(sortByStatus);
  discoveryChecks.sort(sortByStatus);
  qualityChecks.sort(sortByStatus);

  const handleSpecialAction = (route: string) => {
    if (route === '#set-society-location' || route === '#set-store-location') {
      setLocationSheetOpen(true);
    }
  };

  return (
    <>
      <Drawer>
        <DrawerTrigger asChild>
          <Card className={cn(
            'p-3 cursor-pointer border',
            isFullyVisible ? 'border-success/30' : criticalBlockers > 0 ? 'border-destructive/30' : 'border-warning/30'
          )}>
            <div className="flex items-center gap-3 mb-2">
              <ShieldCheck size={18} className={cn(
                'shrink-0',
                isFullyVisible ? 'text-success' : criticalBlockers > 0 ? 'text-destructive' : 'text-warning'
              )} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Store Health</p>
                  <span className="text-[10px] text-muted-foreground">{passCount}/{totalChecks} passed</span>
                </div>
              </div>
              <ChevronRight size={14} className="text-muted-foreground shrink-0" />
            </div>
            <Progress value={percentage} className="h-1.5" />
            {issues.length > 0 && (() => {
              // Highlight the single most impactful action (first fail, then first warn)
              const topAction = issues.find(i => i.status === 'fail') || issues[0];
              return (
                <div className="mt-1.5">
                  <p className="text-[10px] text-warning font-medium flex items-center gap-1">
                    <Sparkles size={10} className="shrink-0" />
                    Top priority: {topAction.label}
                    {topAction.actionLabel && <span className="text-primary ml-0.5">→ {topAction.actionLabel}</span>}
                  </p>
                  {issues.length > 1 && (
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      +{issues.length - 1} more issue{issues.length > 2 ? 's' : ''}
                    </p>
                  )}
                </div>
              );
            })()}
            {isFullyVisible && (
              <p className="text-[10px] text-success mt-1.5">✓ All checks passed</p>
            )}
          </Card>
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-base">Store Visibility Checklist</DrawerTitle>
            <p className="text-xs text-muted-foreground">{passCount}/{totalChecks} checks passed · {percentage}% complete</p>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-4 overflow-y-auto">
            <CheckGroup groupKey="critical" checks={criticalChecks} onSpecialAction={handleSpecialAction} />
            <CheckGroup groupKey="products" checks={productChecks} onSpecialAction={handleSpecialAction} />
            <CheckGroup groupKey="discovery" checks={discoveryChecks} onSpecialAction={handleSpecialAction} />
            <CheckGroup groupKey="quality" checks={qualityChecks} onSpecialAction={handleSpecialAction} />
          </div>
        </DrawerContent>
      </Drawer>
      <SetStoreLocationSheet open={locationSheetOpen} onOpenChange={setLocationSheetOpen} sellerId={sellerId} />
    </>
  );
}