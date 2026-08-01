// @ts-nocheck
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Settings, PlusCircle, Tag, Wallet, TrendingUp } from 'lucide-react';
import { ShareMyStore } from './ShareMyStore';

export function QuickActions() {
  return (
    <div className="space-y-4">
      {/* Operations */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Operations</p>
        <div className="grid grid-cols-3 gap-2">
          <ActionCard to="/seller/products" icon={Plus} iconBg="bg-primary/10" iconColor="text-primary" label="Products" sub="Add or edit" />
          <ActionCard to="/seller/settings" icon={Settings} iconBg="bg-secondary" iconColor="text-secondary-foreground" label="Settings" sub="Payment & hours" />
          <ActionCard to="/become-seller" icon={PlusCircle} iconBg="bg-accent/10" iconColor="text-accent" label="Add Business" sub="New store" dashed />
        </div>
      </div>

      {/* Marketing & Finance */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Marketing & Finance</p>
        <ShareMyStore />
        <div className="grid grid-cols-3 gap-2 mt-2">
          <ActionCard to="/seller/earnings" icon={TrendingUp} iconBg="bg-success/10" iconColor="text-success" label="Earnings" sub="Revenue data" />
          <ActionCard to="/seller/payouts" icon={Wallet} iconBg="bg-primary/10" iconColor="text-primary" label="Payouts" sub="Settlement ledger" />
          <ActionCard to="#coupons" icon={Tag} iconBg="bg-warning/10" iconColor="text-warning" label="Coupons" sub="Discounts" scrollTo="coupon-section" />
        </div>
      </div>
    </div>
  );
}

function ActionCard({ to, icon: Icon, iconBg, iconColor, label, sub, dashed, scrollTo }: any) {
  const content = (
    <Card className={`hover:shadow-md transition-shadow cursor-pointer h-full ${dashed ? 'border-dashed' : ''}`}>
      <CardContent className="p-3 flex flex-col items-center gap-1.5 text-center">
        <div className={`w-9 h-9 rounded-full ${iconBg} flex items-center justify-center`}>
          <Icon className={iconColor} size={18} />
        </div>
        <div>
          <p className="font-medium text-xs">{label}</p>
          <p className="text-[10px] text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );

  if (scrollTo) {
    return (
      <button onClick={() => document.getElementById(scrollTo)?.scrollIntoView({ behavior: 'smooth' })} className="text-left">
        {content}
      </button>
    );
  }

  return <Link to={to}>{content}</Link>;
}
