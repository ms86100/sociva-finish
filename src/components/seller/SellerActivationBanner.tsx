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
          <p className="text-sm font-semibold">You're almost ready to start selling</p>
          <p className="text-xs text-muted-foreground mt-1">
            {allStores
              ? 'Your store has been approved, but Sociva Credits still need to be activated before products can be visible to buyers.'
              : 'Your store has been approved, but your Sociva Credit balance needs to be activated before your products can be visible to buyers.'}
          </p>
          <Link to={SELLER_CREDITS_ROUTE}>
            <Button size="sm" className="mt-3 h-8 text-xs">
              Recharge Now
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
