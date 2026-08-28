// @ts-nocheck
import { useAuth } from '@/contexts/AuthContext';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { resolveStoreCategoryLabel } from '@/lib/store-category-label';
import { ChevronDown, Store, Plus, Check, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ALL_STORES_ID, isPortfolioSellerId } from '@/lib/seller-order-board';

type SellerSwitcherVariant = 'default' | 'header';

export function SellerSwitcher({
  compact = false,
  variant = 'default',
}: {
  compact?: boolean;
  variant?: SellerSwitcherVariant;
}) {
  const { sellerProfiles, currentSellerId, setCurrentSellerId } = useAuth();
  const { configs } = useCategoryConfigs();

  if (sellerProfiles.length === 0) {
    return null;
  }

  const portfolio = isPortfolioSellerId(currentSellerId);
  const currentSeller = sellerProfiles.find((s) => s.id === currentSellerId);
  const isHeader = variant === 'header';

  if (sellerProfiles.length === 1) {
    if (compact || isHeader) return null;
    return (
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-primary/10 border border-primary/20 rounded-xl">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <Store size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground leading-none mb-0.5">Active store</p>
          <p className="font-semibold text-sm truncate text-foreground">
            {currentSeller?.business_name || 'Your Business'}
          </p>
          {currentSeller && (
            <p className="text-[10px] text-muted-foreground truncate">
              {resolveStoreCategoryLabel(currentSeller, configs)}
            </p>
          )}
        </div>
      </div>
    );
  }

  const label = portfolio
    ? 'All stores'
    : currentSeller?.business_name || 'Select store';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/10 text-left transition-colors hover:bg-primary/15',
            isHeader
              ? 'w-full max-w-full px-2.5 py-2'
              : 'w-full gap-3 px-3 py-2.5',
          )}
        >
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            {portfolio ? (
              <LayoutGrid size={14} className="text-primary" />
            ) : (
              <Store size={14} className="text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {!isHeader && (
              <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                {portfolio ? 'Portfolio view' : 'Active store'}
              </p>
            )}
            <p className={cn('font-semibold truncate text-foreground', isHeader ? 'text-xs' : 'text-sm')}>
              {label}
            </p>
          </div>
          <ChevronDown size={14} className="text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(calc(100vw-2rem),320px)]">
        <div className="px-2 py-1.5">
          <p className="text-xs font-medium text-muted-foreground">Switch store</p>
        </div>
        <DropdownMenuItem
          onClick={() => setCurrentSellerId(ALL_STORES_ID)}
          className={cn(
            'flex items-center gap-3 cursor-pointer py-2.5 px-2 rounded-lg mx-1',
            portfolio && 'bg-primary/10',
          )}
        >
          <LayoutGrid size={14} className="text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">All stores</p>
            <p className="text-xs text-muted-foreground">
              Summed totals · {sellerProfiles.length} stores
            </p>
          </div>
          {portfolio && <Check size={16} className="text-primary shrink-0" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {sellerProfiles.map((seller) => (
          <DropdownMenuItem
            key={seller.id}
            onClick={() => setCurrentSellerId(seller.id)}
            className={cn(
              'flex items-center gap-3 cursor-pointer py-2.5 px-2 rounded-lg mx-1',
              !portfolio && seller.id === currentSellerId && 'bg-primary/10',
            )}
          >
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full shrink-0',
                seller.verification_status === 'approved'
                  ? 'bg-accent'
                  : seller.verification_status === 'pending'
                    ? 'bg-warning'
                    : 'bg-destructive',
              )}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{seller.business_name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {resolveStoreCategoryLabel(seller, configs)}
              </p>
            </div>
            {!portfolio && seller.id === currentSellerId && (
              <Check size={16} className="text-primary shrink-0" />
            )}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/become-seller" className="flex items-center gap-2 text-primary cursor-pointer">
            <Plus size={16} />
            <span>Add another business</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
