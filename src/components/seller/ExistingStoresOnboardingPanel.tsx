// @ts-nocheck
import { Link } from 'react-router-dom';
import { Store, ChevronRight, Plus, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { resolveStoreCategoryLabel } from '@/lib/store-category-label';
import { isShelvedSellerStore, displaySellerStoreName } from '@/lib/seller-journey';
import type { CategoryConfig } from '@/types/categories';

interface StoreRow {
  id: string;
  business_name: string;
  verification_status?: string | null;
  primary_group?: string | null;
  categories?: string[] | null;
}

interface ExistingStoresOnboardingPanelProps {
  stores: StoreRow[];
  configs: CategoryConfig[];
  currentDraftId?: string | null;
  onResumeDraft: (store: StoreRow) => void;
  onAddNewStore: () => void;
  onManageStore: (storeId: string) => void;
}

export function ExistingStoresOnboardingPanel({
  stores,
  configs,
  currentDraftId,
  onResumeDraft,
  onAddNewStore,
  onManageStore,
}: ExistingStoresOnboardingPanelProps) {
  const visibleStores = (stores || []).filter((s) => !isShelvedSellerStore(s));
  if (!visibleStores.length) return null;

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold">Your stores</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Sociva allows one store per category. Resume an existing store or add a new one in a different category.
        </p>
      </div>
      <div className="space-y-2">
        {visibleStores.map((store) => {
          const status = store.verification_status || 'draft';
          const categoryLabel = resolveStoreCategoryLabel(store, configs);
          const isDraft = status === 'draft';
          const isActive = store.id === currentDraftId;

          return (
            <div
              key={store.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border',
                isActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
              )}
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <Store size={18} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">
                  {displaySellerStoreName(store.business_name, 'Untitled store')}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">{categoryLabel}</p>
                <div className="mt-1">
                  {status === 'approved' && (
                    <Badge variant="outline" className="text-[9px] h-4 text-success border-success">
                      <CheckCircle2 size={8} className="mr-0.5" /> Approved
                    </Badge>
                  )}
                  {status === 'pending' && (
                    <Badge variant="outline" className="text-[9px] h-4 text-warning border-warning">
                      <Clock size={8} className="mr-0.5" /> Under review
                    </Badge>
                  )}
                  {isDraft && (
                    <Badge variant="outline" className="text-[9px] h-4">Draft — setup incomplete</Badge>
                  )}
                  {status === 'rejected' && (
                    <Badge variant="outline" className="text-[9px] h-4 text-destructive border-destructive">Needs updates</Badge>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {isDraft ? (
                  <Button size="sm" variant={isActive ? 'secondary' : 'outline'} onClick={() => onResumeDraft(store)}>
                    {isActive ? 'Continuing' : 'Resume'}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onManageStore(store.id)}>
                    Manage<ChevronRight size={14} className="ml-0.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" className="w-full" onClick={onAddNewStore}>
        <Plus size={16} className="mr-2" />Add store in a new category
      </Button>
      <p className="text-[10px] text-center text-muted-foreground">
        Manage stores anytime from the{' '}
        <Link to="/seller" className="text-primary underline">Seller Dashboard</Link>
      </p>
    </div>
  );
}
