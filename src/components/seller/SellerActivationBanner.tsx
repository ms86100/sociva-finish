import { Link } from 'react-router-dom';
import { Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SELLER_CREDITS_ROUTE } from '@/lib/sellerCredits';

export function SellerActivationBanner({
  visible,
  allStores = false,
}: {
  visible: boolean;
  allStores?: boolean;
}) {
  if (!visible) return null;

  return (
    <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Coins size={18} className="text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Approved — not visible to buyers yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            {allStores
              ? 'Buyers cannot find your stores in search until you recharge Sociva Credits.'
              : 'Buyers cannot find your store in search until you recharge Sociva Credits.'}
          </p>
          <Link to={SELLER_CREDITS_ROUTE}>
            <Button size="sm" className="mt-3 h-8 text-xs">
              Recharge credits
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
